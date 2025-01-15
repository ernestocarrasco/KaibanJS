import fastq from 'fastq';
import { TASK_STATUS_enum } from '../../utils/enums';
import WorkflowExecutionStrategy from './workflowExecutionStrategy';

class SequentialExecutionStrategy extends WorkflowExecutionStrategy {
  constructor(useTeamStore) {
    super(useTeamStore);
    this.taskQueue = fastq(async (task, callback) => {
      await this._executeTask(task);
      callback();
    }, 1);
  }

  async execute(changedTasks, allTasks) {
    // Implement the logic for the sequential execution strategy
    // This method should handle the tasks in the order they are received
    // and ensure that tasks are executed sequentially
    for (const changedTask of changedTasks) {
      switch (changedTask.status) {
        case TASK_STATUS_enum.DOING:
          this.taskQueue.push(changedTask);
          break;
        case TASK_STATUS_enum.REVISE:
          {
            // Find the index of the current revise task
            const taskIndex = allTasks.findIndex(
              (t) => t.id === changedTask.id
            );

            // Move all subsequent tasks to TODO
            for (let i = taskIndex + 1; i < allTasks.length; i++) {
              this._updateTaskStatus(allTasks[i].id, TASK_STATUS_enum.TODO);
            }

            this._updateTaskStatus(changedTask.id, TASK_STATUS_enum.DOING);
          }
          break;
        case TASK_STATUS_enum.DONE:
          {
            const tasks = this.useTeamStore.getState().tasks;
            const nextTask = tasks.find(
              (t) => t.status === TASK_STATUS_enum.TODO
            );
            console.log({ nextTask });
            if (nextTask) {
              this._updateTaskStatus(nextTask.id, TASK_STATUS_enum.DOING);
            }
          }
          break;
      }
    }
  }
}

export default SequentialExecutionStrategy;
