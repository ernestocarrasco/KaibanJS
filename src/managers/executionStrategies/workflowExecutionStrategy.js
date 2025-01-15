import { cloneAgent } from '../../utils/agents';
import { TASK_STATUS_enum } from '../../utils/enums';
/**
 * Abstract base class defining the workflow execution strategy interface
 */
class WorkflowExecutionStrategy {
  constructor(useTeamStore) {
    if (this.constructor === WorkflowExecutionStrategy) {
      throw new Error(
        'Cannot instantiate abstract WorkflowExecutionStrategy directly'
      );
    }
    this.useTeamStore = useTeamStore;
  }

  _isAgentBusy(agent, tasks) {
    return tasks.some(
      (t) =>
        t.agent &&
        t.agent.id === agent.id &&
        t.status === TASK_STATUS_enum.DOING
    );
  }

  /**
   * Execute the task
   * @param {Object} task - The task to execute
   */
  async _executeTask(task) {
    const agent = this._isAgentBusy(
      task.agent,
      this.useTeamStore.getState().tasks
    )
      ? cloneAgent(task.agent)
      : task.agent;
    await this.useTeamStore.getState().workOnTask(agent, task);
  }

  /**
   * Updates the status of a task in the store
   * @param {string} taskId - The ID of the task to update
   * @param {string} status - The new status to set
   */
  _updateTaskStatus(taskId, status) {
    this.useTeamStore.getState().updateTaskStatus(taskId, status);
  }

  _updateStatusOfMultipleTasks(tasks, status) {
    this.useTeamStore.getState().updateStatusOfMultipleTasks(tasks, status);
  }

  /**
   * Execute the strategy for the given changed tasks
   * @param {Array} changedTasks - Array of tasks that have changed status
   * @param {Array} allTasks - Array of all tasks in the workflow
   */
  async execute(_changedTasks, _allTasks) {
    throw new Error('execute() must be implemented by concrete strategies');
  }
}

export default WorkflowExecutionStrategy;
