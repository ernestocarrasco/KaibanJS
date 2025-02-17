/**
 * State Management Store.
 *
 * This file defines the Zustand store used across the library to manage and maintain state. The store
 * facilitates reactive and efficient updates to the state of agents, tasks, and team workflows, ensuring
 * that the application remains responsive and data-driven. It provides a centralized location for state.
 *
 * Usage:
 * The store is designed to be imported and used directly in components or services where state management
 * is required, offering straightforward access to state properties and actions to modify them.
 */
import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import PQueue from 'p-queue';
import { ChatMessageHistory } from 'langchain/stores/message/in_memory';
import { useAgentStore } from './agentStore';
import { useTaskStore } from './taskStore';
import { useWorkflowLoopStore } from './workflowLoopStore';
import {
  AGENT_STATUS_enum,
  FEEDBACK_STATUS_enum,
  TASK_STATUS_enum,
  WORKFLOW_STATUS_enum,
} from '../utils/enums';
import { calculateTotalWorkflowCost } from '../utils/llmCostCalculator';
import { logger, setLogLevel } from '../utils/logger';
import {
  getTaskTitleForLogs,
  interpolateTaskDescription,
} from '../utils/tasks';
import { initializeTelemetry } from '../utils/telemetry';
import DeterministicExecutionStrategy from '../workflowExecution/executionStrategies/deterministicExecutionStrategy';
import ManagerLLMStrategy from '../workflowExecution/executionStrategies/managerLLMExecutionStrategy';

// Initialize telemetry with default values
const td = initializeTelemetry();

// ──── Store Factory for Multiple Teams ───────────────────────────────
//
// Implements a store factory instead of a standard Zustand store to manage state for multiple teams.
// This design supports isolated state management for each team's agents and workflows,
// allowing multiple teams to operate concurrently with their own tasks and statuses.
// ─────────────────────────────────────────────────────────────────────

const createTeamStore = (initialState = {}) => {
  // Define the store with centralized state management and actions
  if (initialState.logLevel) {
    setLogLevel(initialState.logLevel); // Update logger level if provided
  }
  const useTeamStore = create(
    devtools(
      subscribeWithSelector(
        (set, get) => ({
          ...useAgentStore(set, get),
          ...useTaskStore(set, get),
          ...useWorkflowLoopStore(set, get),
          teamWorkflowStatus:
            initialState.teamWorkflowStatus || WORKFLOW_STATUS_enum.INITIAL,
          workflowResult: initialState.workflowResult || null,
          name: initialState.name || '',
          agents: initialState.agents || [],
          tasks: initialState.tasks || [],
          workflowLogs: initialState.workflowLogs || [],
          inputs: initialState.inputs || {},
          workflowContext: initialState.workflowContext || '',
          workflowInternalMemory: initialState.workflowInternalMemory || {},
          env: initialState.env || {},
          logLevel: initialState.logLevel,
          flowType: initialState.flowType,
          workflowExecutionStrategy: undefined,
          workflowController: initialState.workflowController || {},

          // Maximum number of tasks that can be executed in parallel
          maxConcurrency: initialState.maxConcurrency || 5,

          setInputs: (inputs) => set({ inputs }), // Add a new action to update inputs
          setName: (name) => set({ name }), // Add a new action to update inputs
          setEnv: (env) => set({ env }), // Add a new action to update inputs

          // Add action to update workflowInternalMemory
          updateWorkflowInternalMemory: (updates) =>
            set((state) => ({
              workflowInternalMemory: {
                ...state.workflowInternalMemory,
                ...updates,
              },
            })),

          // Add action to clear workflowInternalMemory
          clearWorkflowInternalMemory: () =>
            set({ workflowInternalMemory: {} }),

          addAgents: (agents) => {
            const { env } = get();
            agents.forEach((agent) => {
              agent.initialize(useTeamStore, env);
            });
            set((state) => ({ agents: [...state.agents, ...agents] }));
          },

          addTasks: (tasks) => {
            tasks.forEach((task) => task.setStore(useTeamStore));
            set((state) => ({
              tasks: [
                ...state.tasks,
                ...tasks.map((task) => ({ ...task, agent: task.agent })),
              ],
            }));
          },

          /**
           * Update the status of a single task. This method:
           * - Updates the task's status in the tasks array
           *
           * @param {string} taskId - The ID of the task to update
           * @param {string} status - The new status for the task
           */
          updateTaskStatus: (taskId, status) => {
            set((state) => {
              // Update task status
              const updatedTasks = state.tasks.map((task) =>
                task.id === taskId ? { ...task, status } : task
              );

              return {
                ...state,
                tasks: updatedTasks,
              };
            });
          },

          /**
           * Update the status of multiple tasks at once. This method:
           * - Updates the status of all specified tasks in the tasks array
           *
           * @param {string[]} taskIds - The IDs of the tasks to update
           * @param {string} status - The new status for the tasks
           */
          updateStatusOfMultipleTasks: (taskIds, status) => {
            set((state) => {
              // Update tasks status
              const updatedTasks = state.tasks.map((task) =>
                taskIds.includes(task.id) ? { ...task, status } : task
              );
              return {
                ...state,
                tasks: updatedTasks,
              };
            });
          },

          createWorkflowExecutionStrategy: () => {
            const state = get();

            // Check if team has managerWithLLM enabled
            if (state.managerWithLLM) {
              return new ManagerLLMStrategy(state);
            }

            // Use deterministic strategy for all other cases
            return new DeterministicExecutionStrategy(state);
          },

          startWorkflow: async (inputs) => {
            // Start the first task or set all to 'TODO' initially
            logger.info(`🚀 Team *${get().name}* is starting to work.`);
            td.signal('workflow_started');
            get().resetWorkflowStateAction();

            if (inputs) {
              get().setInputs(inputs);
            }

            // Create a log entry to mark the initiation of the workflow
            const initialLog = {
              task: null,
              agent: null,
              timestamp: Date.now(),
              logDescription: `Workflow initiated for team *${get().name}*.`,
              workflowStatus: WORKFLOW_STATUS_enum.RUNNING,
              metadata: {
                message: 'Workflow has been initialized with input settings.',
                inputs: inputs,
              },
              logType: 'WorkflowStatusUpdate',
            };

            const strategy = get().createWorkflowExecutionStrategy();

            // Update state with the new log
            set((state) => ({
              ...state,
              workflowLogs: [...state.workflowLogs, initialLog],
              teamWorkflowStatus: WORKFLOW_STATUS_enum.RUNNING,
              workflowExecutionStrategy: strategy,
            }));

            // init task queue
            get().taskQueue = new PQueue({
              concurrency: strategy.getConcurrencyForTaskQueue(get()),
              autoStart: true,
            });

            await strategy.startExecution(get());
          },

          handleChangedTasks: async (changedTaskIdsWithPreviousStatus) => {
            const strategy = get().workflowExecutionStrategy;

            if (strategy) {
              strategy
                .executeFromChangedTasks(
                  get(),
                  changedTaskIdsWithPreviousStatus
                )
                .then(() => {
                  logger.debug(
                    `Workflow execution strategy executed from changed tasks (${changedTaskIdsWithPreviousStatus.join(
                      ', '
                    )})`
                  );
                })
                .catch((error) => {
                  logger.error(
                    `Error executing workflow execution strategy from changed tasks (${changedTaskIdsWithPreviousStatus.join(
                      ', '
                    )}): ${error.message}`
                  );
                });
            }
          },

          resetWorkflowStateAction: () => {
            set((state) => {
              // Cloning tasks and agents to ensure there are no direct mutations
              const resetTasks = state.tasks.map((task) => ({
                ...task,
                status: TASK_STATUS_enum.TODO,
                // Ensure to reset or clear any other task-specific states if needed
              }));

              get().agents.forEach((agent) => {
                agent.setStatus('INITIAL');
                // Update status using agent's method
                agent.agentInstance.interactionsHistory =
                  new ChatMessageHistory();
                agent.agentInstance.lastFeedbackMessage = null;
                agent.agentInstance.currentIterations = 0;
              });

              const resetAgents = [...state.agents];

              return {
                ...state,
                tasks: resetTasks,
                agents: resetAgents,
                workflowLogs: [],
                workflowContext: '',
                workflowResult: null,
                workflowInternalMemory: {},
                teamWorkflowStatus: WORKFLOW_STATUS_enum.INITIAL,
              };
            });

            logger.debug('Workflow state has been reset.');
          },

          // New function to handle finishing workflow
          finishWorkflowAction: () => {
            const stats = get().getWorkflowStats();
            const tasks = get().tasks;
            const deliverableTask = tasks
              .slice()
              .reverse()
              .find((task) => task.isDeliverable);
            const lastTaskResult = tasks[tasks.length - 1].result;

            // Detailed console logging
            logger.debug(
              `Workflow Result:`,
              deliverableTask ? deliverableTask.result : lastTaskResult
            );

            // Prepare the log entry for finishing the workflow
            const newLog = {
              task: null,
              agent: null,
              timestamp: Date.now(),
              logDescription: `Workflow finished with result: ${
                deliverableTask ? deliverableTask.result : lastTaskResult
              }`,
              workflowStatus: WORKFLOW_STATUS_enum.FINISHED,
              metadata: {
                result: deliverableTask
                  ? deliverableTask.result
                  : lastTaskResult,
                ...stats,
              },
              logType: 'WorkflowStatusUpdate',
            };

            // Update state with the final results and set workflow status
            set((state) => ({
              ...state,
              workflowResult: deliverableTask
                ? deliverableTask.result
                : lastTaskResult, // Set the final result
              teamWorkflowStatus: WORKFLOW_STATUS_enum.FINISHED, // Set status to indicate a finished workflow
              workflowLogs: [...state.workflowLogs, newLog], // Append new log to the logs array
            }));
          },
          // Add a new action to update teamWorkflowStatus
          setTeamWorkflowStatus: (status) =>
            set({ teamWorkflowStatus: status }),
          // Function to handle errors during workflow execution
          // Adjusted method to handle workflow errors
          handleWorkflowError: (task, error) => {
            // Detailed console error logging
            logger.error(`Workflow Error:`, error.message);
            const stats = get().getWorkflowStats();
            // Prepare the error log with specific workflow context
            const newLog = {
              task,
              agent: task.agent,
              timestamp: Date.now(),
              logDescription: `Workflow error encountered: ${error.message}`,
              workflowStatus: WORKFLOW_STATUS_enum.ERRORED,
              metadata: {
                error,
                ...stats,
              },
              logType: 'WorkflowStatusUpdate',
            };

            // Update state with error details and add new log entry
            set((state) => ({
              ...state,
              teamWorkflowStatus: WORKFLOW_STATUS_enum.ERRORED, // Set status to indicate an error
              workflowLogs: [...state.workflowLogs, newLog], // Append new log to the logs array
            }));
          },

          handleWorkflowBlocked: ({ task, error }) => {
            // Detailed console error logging
            logger.warn(`WORKFLOW BLOCKED:`, error.message);

            // Get current workflow stats
            const stats = get().getWorkflowStats();

            // Prepare the error log with specific workflow context
            const newLog = {
              task,
              agent: task.agent,
              timestamp: Date.now(),
              logDescription: `Workflow blocked: ${error.message}`,
              workflowStatus: WORKFLOW_STATUS_enum.BLOCKED,
              metadata: {
                error: error.message,
                ...stats,
                teamName: get().name,
                taskCount: get().tasks.length,
                agentCount: get().agents.length,
              },
              logType: 'WorkflowStatusUpdate',
            };

            // Update state with error details and add new log entry
            set((state) => ({
              ...state,
              teamWorkflowStatus: WORKFLOW_STATUS_enum.BLOCKED, // Set status to indicate a blocked workflow
              workflowLogs: [...state.workflowLogs, newLog], // Append new log to the logs array
            }));
          },
          handleWorkflowAborted: ({ task, error }) => {
            // Detailed console error logging
            logger.warn(`WORKFLOW ABORTED:`, error.message);
            // Get current workflow stats
            const stats = get().getWorkflowStats();

            // Prepare the error log with specific workflow context
            const newLog = {
              task,
              agent: task.agent,
              timestamp: Date.now(),
              logDescription: `Workflow aborted: ${error.message}`,
              workflowStatus: WORKFLOW_STATUS_enum.STOPPED,
              metadata: {
                error: error.message,
                ...stats,
                teamName: get().name,
                taskCount: get().tasks.length,
                agentCount: get().agents.length,
              },
              logType: 'WorkflowStatusUpdate',
            };

            // Update state with error details and add new log entry
            set((state) => ({
              ...state,
              teamWorkflowStatus: WORKFLOW_STATUS_enum.STOPPED, // Set status to indicate a blocked workflow
              workflowLogs: [...state.workflowLogs, newLog], // Append new log to the logs array
            }));
          },
          workOnTask: async (agent, task, context) => {
            if (task && agent) {
              // Log the start of the task
              logger.debug(`Task: ${getTaskTitleForLogs(task)} starting...`);
              task.status = TASK_STATUS_enum.DOING;
              // Add a log entry for the task starting
              set((state) => {
                const newLog = get().prepareNewLog({
                  agent,
                  task,
                  logDescription: `Task: ${getTaskTitleForLogs(task)} started.`,
                  metadata: {}, // Initial metadata can be empty or include the start time
                  logType: 'TaskStatusUpdate',
                });
                return {
                  ...state,
                  workflowLogs: [...state.workflowLogs, newLog],
                };
              });

              // Execute the task and let the agent report completion
              task.inputs = get().inputs; // Pass the inputs to the task
              const interpolatedTaskDescription = interpolateTaskDescription(
                task.description,
                get().inputs
              );
              task.interpolatedTaskDescription = interpolatedTaskDescription;

              // Get pending feedbacks directly from the task
              const pendingFeedbacks = task.feedbackHistory.filter(
                (f) => f.status === FEEDBACK_STATUS_enum.PENDING
              );

              // // Derive the current context from workflowLogs, passing the current task ID
              // const currentContext = get().deriveContextFromLogs(
              //   get().workflowLogs,
              //   task.id
              // );

              const currentContext = context;

              // Check if the task has pending feedbacks
              if (pendingFeedbacks.length > 0) {
                // If there are pending feedbacks, work on feedback
                await agent.workOnFeedback(
                  task,
                  task.feedbackHistory,
                  currentContext
                );
              } else {
                // If no pending feedbacks, work on task as usual
                await agent.workOnTask(task, get().inputs, currentContext);
              }
            }
          },
          workOnTaskResume: async (agent, task) => {
            await agent.workOnTaskResume(task);
          },
          deriveContextFromLogs: (logs, currentTaskId) => {
            const taskResults = new Map();
            const tasks = get().tasks; // Get the tasks array from the store
            const currentTaskIndex = tasks.findIndex(
              (task) => task.id === currentTaskId
            );

            if (currentTaskIndex === -1) {
              console.warn(
                `Current task with ID ${currentTaskId} not found in the task list.`
              );
              return ''; // Return empty context if current task is not found
            }

            // Iterate through logs to get the most recent result for each task
            for (const log of logs) {
              if (
                log.logType === 'TaskStatusUpdate' &&
                log.taskStatus === TASK_STATUS_enum.DONE
              ) {
                const taskIndex = tasks.findIndex(
                  (task) => task.id === log.task.id
                );

                // Only include tasks that come before the current task in the workflow
                if (taskIndex !== -1 && taskIndex < currentTaskIndex) {
                  taskResults.set(log.task.id, {
                    taskDescription: log.task.description,
                    result: log.metadata.result,
                    index: taskIndex, // Store the index for sorting later
                  });
                }
              }
            }

            // Sort the results based on their original task order and create the context string
            return Array.from(taskResults.values())
              .sort((a, b) => a.index - b.index)
              .map(
                ({ taskDescription, result }) =>
                  `Task: ${taskDescription}\nResult: ${
                    typeof result === 'object' ? JSON.stringify(result) : result
                  }\n`
              )
              .join('\n');
          },

          provideFeedback: async (taskId, feedbackContent) => {
            const { tasks } = get(); // Access the required actions and state from the store

            // Find the task
            const taskIndex = tasks.findIndex((t) => t.id === taskId);
            if (taskIndex === -1) {
              logger.error('Task not found');
              return;
            }
            const task = tasks[taskIndex];

            // Create a feedback object
            const newFeedback = {
              content: feedbackContent,
              status: FEEDBACK_STATUS_enum.PENDING,
              timestamp: Date.now(),
            };

            const newWorkflowLog = {
              task,
              agent: task.agent,
              timestamp: Date.now(),
              logDescription: `Workflow running again due to feedback on task.`,
              workflowStatus: WORKFLOW_STATUS_enum.RUNNING,
              metadata: {
                feedback: newFeedback,
              },
              logType: 'WorkflowStatusUpdate',
            };

            // Add the feedback to the task
            const updatedTask = {
              ...task,
              feedbackHistory: [...(task.feedbackHistory || []), newFeedback],
              status: TASK_STATUS_enum.REVISE,
            };

            const newTaskLog = get().prepareNewLog({
              agent: updatedTask.agent,
              task: updatedTask,
              logDescription: `Task with feedback: ${getTaskTitleForLogs(
                updatedTask
              )}.`,
              metadata: {
                feedback: newFeedback,
              },
              logType: 'TaskStatusUpdate',
            });

            set((state) => ({
              ...state,
              teamWorkflowStatus: WORKFLOW_STATUS_enum.RUNNING,
              workflowLogs: [...state.workflowLogs, newWorkflowLog, newTaskLog],
              tasks: state.tasks.map((t) =>
                t.id === taskId ? updatedTask : t
              ),
            }));
          },

          validateTask: async (taskId) => {
            const task = get().tasks.find((t) => t.id === taskId);
            if (!task) {
              logger.error('Task not found');
              return null;
            }
            // TODO: See what is the best value to return on this case
            if (task.status !== TASK_STATUS_enum.AWAITING_VALIDATION) {
              logger.error('Task is not awaiting validation');
              return null;
            }

            const updatedTask = {
              ...task,
              status: TASK_STATUS_enum.VALIDATED,
            };

            const newWorkflowLog = {
              task: updatedTask,
              agent: updatedTask.agent,
              timestamp: Date.now(),
              logDescription: `Workflow running cause a task was validated.`,
              workflowStatus: WORKFLOW_STATUS_enum.RUNNING,
              metadata: {},
              logType: 'WorkflowStatusUpdate',
            };

            const newTaskLog = get().prepareNewLog({
              agent: updatedTask.agent,
              task: updatedTask,
              metadata: {},
              logDescription: `Task validated: ${getTaskTitleForLogs(
                updatedTask
              )}.`,
              logType: 'TaskStatusUpdate',
            });

            set((state) => ({
              ...state,
              tasks: state.tasks.map((t) =>
                t.id === taskId ? updatedTask : t
              ),
              workflowLogs: [...state.workflowLogs, newWorkflowLog, newTaskLog],
              teamWorkflowStatus: WORKFLOW_STATUS_enum.RUNNING,
            }));

            //TODO: See if we can do it in a reactive way, using the same pattern we already have
            get().handleTaskCompleted({
              agent: updatedTask.agent,
              task: updatedTask,
              result: updatedTask.result,
            });
          },

          /**
           * Prepares a new log entry to the centralized activity logs.
           *
           * @param {Object} params - The parameters for the log entry.
           * @param {string} params.agentId - Identifier for the agent performing the action.
           * @param {string} params.taskId - Identifier of the task associated with this log entry.
           * @param {string} params.logDescription - Descriptive text detailing what the log entry is about.
           * @param {Object} params.metadata - Additional structured data providing more context about the action.
           * @param {string} params.logType - Categorization of the log entry to facilitate filtering and analysis.
           *
           */
          prepareNewLog: ({
            agent,
            task,
            logDescription,
            metadata,
            logType,
          }) => {
            const timestamp = Date.now(); // Current time in milliseconds since Unix Epoch

            // Construct the new log entry
            const newLog = {
              timestamp,
              task,
              agent,
              agentName: agent ? agent.name : 'Unknown Agent',
              taskTitle: task ? getTaskTitleForLogs(task) : 'Untitled Task',
              logDescription,
              taskStatus: task ? task.status : 'Unknown',
              agentStatus: agent ? agent.status : 'Unknown',
              metadata,
              logType,
            };

            return newLog;
          },
          clearAll: () =>
            set({
              agents: [],
              tasks: [],
              inputs: {},
              workflowLogs: [],
              workflowContext: '',
              workflowResult: null,
              teamWorkflowStatus: WORKFLOW_STATUS_enum.INITIAL,
            }),
          getWorkflowStats() {
            const endTime = Date.now(); // Consider the current time as the end time
            const workflowLogs = get().workflowLogs;
            const lastWorkflowRunningLog = workflowLogs
              .slice()
              .reverse()
              .find(
                (log) =>
                  log.logType === 'WorkflowStatusUpdate' &&
                  log.workflowStatus === 'RUNNING'
              );

            const startTime = lastWorkflowRunningLog
              ? lastWorkflowRunningLog.timestamp
              : Date.now();
            const duration = (endTime - startTime) / 1000; // Calculate duration in seconds
            let modelUsageStats = {};

            let llmUsageStats = {
              inputTokens: 0,
              outputTokens: 0,
              callsCount: 0,
              callsErrorCount: 0,
              parsingErrors: 0,
            };
            let iterationCount = 0;

            // Iterate over logs for usage stats, starting from the found 'INITIAL' timestamp
            workflowLogs.forEach((log) => {
              if (
                log.logType === 'AgentStatusUpdate' &&
                log.timestamp >= startTime
              ) {
                if (log.agentStatus === AGENT_STATUS_enum.THINKING_END) {
                  const modelCode = log.agent.llmConfig.model;
                  if (!modelUsageStats[modelCode]) {
                    modelUsageStats[modelCode] = {
                      inputTokens: 0,
                      outputTokens: 0,
                      callsCount: 0,
                    };
                  }
                  modelUsageStats[modelCode].inputTokens +=
                    log.metadata.output.llmUsageStats.inputTokens;
                  modelUsageStats[modelCode].outputTokens +=
                    log.metadata.output.llmUsageStats.outputTokens;
                  modelUsageStats[modelCode].callsCount += 1; // Each log entry counts as a call
                  llmUsageStats.inputTokens +=
                    log.metadata.output.llmUsageStats.inputTokens;
                  llmUsageStats.outputTokens +=
                    log.metadata.output.llmUsageStats.outputTokens;
                  llmUsageStats.callsCount += 1;
                } else if (
                  log.agentStatus === AGENT_STATUS_enum.THINKING_ERROR
                ) {
                  llmUsageStats.callsErrorCount += 1;
                } else if (
                  log.agentStatus ===
                  AGENT_STATUS_enum.ISSUES_PARSING_LLM_OUTPUT
                ) {
                  llmUsageStats.parsingErrors += 1;
                } else if (
                  log.agentStatus === AGENT_STATUS_enum.ITERATION_END
                ) {
                  iterationCount += 1;
                }
              }
            });

            // Calculate total costs based on the model usage stats
            const costDetails = calculateTotalWorkflowCost(modelUsageStats);

            return {
              startTime,
              endTime,
              duration,
              llmUsageStats,
              iterationCount,
              costDetails,
              taskCount: get().tasks.length,
              agentCount: get().agents.length,
              teamName: get().name,
            };
          },
          getCleanedState() {
            // Function to clean individual agent data
            const cleanAgent = (agent) => {
              const { agentInstance } = agent;
              let cleanedAgentInstance = agentInstance;

              return {
                ...agent,
                id: '[REDACTED]', // Clean sensitive ID at the root level
                env: '[REDACTED]', // Clean sensitive Env in agent
                llmConfig: agent.llmConfig
                  ? {
                      ...agent.llmConfig,
                      apiKey: '[REDACTED]', // Clean API key at the root level
                    }
                  : {}, // Provide an empty object if llmConfig is undefined at the root level
                agentInstance: cleanedAgentInstance
                  ? {
                      ...cleanedAgentInstance,
                      id: '[REDACTED]', // Clean sensitive ID in agentInstance
                      env: '[REDACTED]', // Clean sensitive Env in agentInstance
                      llmConfig: cleanedAgentInstance.llmConfig
                        ? {
                            ...cleanedAgentInstance.llmConfig,
                            apiKey: '[REDACTED]', // Clean API key in agentInstance llmConfig
                          }
                        : {}, // Provide an empty object if llmConfig is undefined in agentInstance
                    }
                  : {}, // Provide an empty object if agentInstance is undefined
              };
            };

            // Function to clean individual task data
            const cleanTask = (task) => {
              const {
                allowParallelExecution = false,
                referenceId,
                hooks: _hooks,
                workflowInternalMemory: _workflowInternalMemory,
                ...rest
              } = task;
              const cleanedTask = {
                ...rest,
                id: '[REDACTED]', // Clean sensitive ID
                agent: task.agent ? cleanAgent(task.agent) : null, // Clean the nested agent if exists
                duration: '[REDACTED]',
                endTime: '[REDACTED]',
                startTime: '[REDACTED]',
                feedbackHistory: task.feedbackHistory
                  ? task.feedbackHistory.map((feedback) => ({
                      ...feedback,
                      timestamp: '[REDACTED]', // Redact the timestamp
                    }))
                  : [], // Provide an empty array if feedbackHistory is undefined
              };

              if (allowParallelExecution) {
                cleanedTask.allowParallelExecution = allowParallelExecution;
              }

              if (referenceId) {
                cleanedTask.referenceId = referenceId;
              }

              return cleanedTask;
            };

            // Function to clean log metadata
            const cleanMetadata = (metadata) => ({
              ...metadata,
              duration: '[REDACTED]',
              endTime: '[REDACTED]',
              startTime: '[REDACTED]',
              feedback: metadata.feedback
                ? {
                    ...metadata.feedback,
                    timestamp: '[REDACTED]', // Redact the timestamp
                  }
                : {}, // Provide an empty object if feedback is undefined
            });

            // Get current state
            const state = get();

            // Extract hooks from state to exclude them
            const { hooks: _hooks, ...cleanedState } = state;

            // Clone and clean agents
            const cleanedAgents = cleanedState.agents.map((agent) =>
              cleanAgent(agent)
            );

            // Clone and clean tasks, including the nested agents
            const cleanedTasks = cleanedState.tasks.map((task) =>
              cleanTask(task)
            );

            // Clone and clean workflowLogs, including the potential agents and tasks
            const cleanedWorkflowLogs = cleanedState.workflowLogs.map(
              (log) => ({
                ...log,
                agent: log.agent ? cleanAgent(log.agent) : null,
                task: log.task ? cleanTask(log.task) : null,
                timestamp: '[REDACTED]',
                metadata: log.metadata ? cleanMetadata(log.metadata) : {},
              })
            );

            // Return only the parts of the state necessary for the snapshot or further processing
            return {
              teamWorkflowStatus: cleanedState.teamWorkflowStatus,
              workflowResult: cleanedState.workflowResult,
              name: cleanedState.name,
              agents: cleanedAgents,
              tasks: cleanedTasks,
              workflowLogs: cleanedWorkflowLogs,
              inputs: cleanedState.inputs,
              workflowContext: cleanedState.workflowContext,
              logLevel: cleanedState.logLevel,
            };
          },
        }),
        'teamStore'
      )
    )
  );

  return useTeamStore;
};

export { createTeamStore };
