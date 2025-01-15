require('dotenv').config({ path: './.env.local' });
// Setup mock
const { mock, restoreAll } = require('../utils/moscaFetch')();
// const { record, getRecords, saveRecords } = require('../utils/moscaFetch')();

const openAITeam = require('./examples/teams/event_planning/openai');
const openAITeamRecordedRequests = require('./examples/teams/event_planning/openai.requests.json');

// Determine if mocks should be applied based on the environment
const withMockedApis =
  process.env.TEST_ENV === 'mocked-llm-apis' ? true : false;

//   record({
//     url: '*',
//     method: '*',
//     body: '*'  // Record any POST request to this URL
// });

describe('OpenAI Team Workflows', () => {
  describe('Using Standard OpenAI Agents', () => {
    beforeEach(() => {
      // Mocking all POST requests with a callback
      if (withMockedApis) {
        mock(openAITeamRecordedRequests);
      }
    });

    afterEach(() => {
      if (withMockedApis) {
        restoreAll();
      }
    });

    it('completes the entire workflow successfully', async () => {
      await openAITeam.start();
      const storeFinalState = openAITeam
        .useStore()
        .getState()
        .getCleanedState();
      expect(storeFinalState).toMatchSnapshot();

      // const recordedData = getRecords();
      // console.log(recordedData);
      // saveRecords();
    });
  });

  describe('Using OpenAI Agents with Custom Prompts', () => {
    beforeEach(() => {
      // Mocking all POST requests with a callback
      if (withMockedApis) {
        mock(openAITeamRecordedRequests);
      }
    });

    afterEach(() => {
      if (withMockedApis) {
        restoreAll();
      }
    });

    it('completes the entire workflow successfully', async () => {
      await openAITeam.start();
      const store = openAITeam.useStore();
      expect(store.getState().getCleanedState()).toMatchSnapshot();

      // const recordedData = getRecords();
      // console.log(recordedData);
      // saveRecords();
    });
  });
});
