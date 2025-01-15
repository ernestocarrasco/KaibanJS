import DepGraph from 'dependency-graph';
import { TASK_STATUS_enum } from '../../utils/enums';
import WorkflowExecutionStrategy from './workflowExecutionStrategy';

/**
 * Class for hierarchical workflow execution strategy
 *
 * This strategy is used when tasks have dependencies on each other, and the workflow needs to be executed in a hierarchical manner.
 * It ensures that tasks are executed in the correct order, taking into account dependencies and ensuring that tasks are not started
 * until all of their prerequisites are complete.
 */
class HierarchyExecutionStrategy extends WorkflowExecutionStrategy {
  constructor(useTeamStore) {
    super(useTeamStore);
    this.graph = new DepGraph();

    // Initialize dependency graph
    const tasks = useTeamStore.getState().tasks;
    tasks.forEach((task) => {
      this.graph.addNode(task.id);
    });

    // Add dependencies
    tasks.forEach((task) => {
      if (task.dependsOn) {
        task.dependsOn.forEach((depId) => {
          this.graph.addDependency(task.id, depId);
        });
      }
    });
  }

  isAgentBusy(agent, tasks) {
    return tasks.some(
      (t) => t.agent.id === agent.id && t.status === TASK_STATUS_enum.DOING
    );
  }

  /**
   * Gets all tasks that the given task depends on (its prerequisites)
   * @param {Object} task - The task to find dependencies for
   * @param {Array} allTasks - Array of all tasks in the workflow
   * @returns {Array} Array of task objects that are dependencies of the given task
   */
  getTaskDependencies(task, allTasks) {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return [];
    }
    return allTasks.filter((t) => task.dependsOn.includes(t.id));
  }

  /**
   * Gets all tasks that depend on the given task (tasks that have this task as a prerequisite)
   * @param {Object} task - The task to find dependent tasks for
   * @param {Array} allTasks - Array of all tasks in the workflow
   * @returns {Array} Array of task objects that depend on the given task
   */
  getAllTasksDependingOn(task, allTasks) {
    return allTasks.filter((t) => t.dependsOn && t.dependsOn.includes(task.id));
  }

  /**
   * Gets all tasks that are ready to be executed
   * @param {Array} allTasks - Array of all tasks in the workflow
   * @returns {Array} Array of task objects that are ready to be executed
   */
  getReadyTasks(allTasks) {
    return allTasks.filter((task) => {
      // Task must be in TODO status
      if (task.status !== TASK_STATUS_enum.TODO) return false;

      // All dependencies must be DONE
      const deps = this.getTaskDependencies(task, allTasks);
      return (
        deps.length === 0 ||
        deps.every((dep) => dep.status === TASK_STATUS_enum.DONE)
      );
    });
  }

  async execute(changedTasks, allTasks) {
    // Handle changed tasks first
    for (const changedTask of changedTasks) {
      switch (changedTask.status) {
        case TASK_STATUS_enum.DOING:
          // Execute the task
          await super._executeTask(changedTask);
          break;

        case TASK_STATUS_enum.REVISE:
          {
            // Block all dependent tasks
            const dependentTasks = this.getAllTasksDependingOn(
              changedTask,
              allTasks
            );
            dependentTasks.forEach((task) => {
              this.useTeamStore
                .getState()
                .updateTaskStatus(task.id, TASK_STATUS_enum.BLOCKED);
            });
          }

          break;
      }
    }

    // Find and execute all possible tasks
    const executableTasks = allTasks.filter((task) => {
      if (task.status !== TASK_STATUS_enum.TODO) return false;

      // Check if task has no dependencies or all dependencies are done
      const deps = this.getTaskDependencies(task, allTasks);
      return (
        deps.length === 0 ||
        deps.every((dep) => dep.status === TASK_STATUS_enum.DONE)
      );
    });

    executableTasks.forEach((task) => {
      super._executeTask(task);
    });
  }
}

export default HierarchyExecutionStrategy;
