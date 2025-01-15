const { Agent, Task, Team } = require('kaibanjs');
const {
  TavilySearchResults,
} = require('@langchain/community/tools/tavily_search');
// const {calculator} = require('@agentic/stdlib/calculator');
// const { createLangChainTools } = require('@agentic/stdlib/langchain');

// Define tools
const searchInternetTool = new TavilySearchResults({
  maxResults: 3,
  apiKey: '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',
});

// const searchInternet = createLangChainTools(rawSearchInternetTool)[0];
// const calculatorTool = createLangChainTools(calculator)[0];

// Define agents with exact roles, goals, and backgrounds from Python example
const eventManagerAgent = new Agent({
  name: 'Peter Atlas',
  role: 'Oversees event planning and ensures smooth execution.',
  goal: 'Coordinate tasks and ensure timely execution.',
  background:
    'Expertise in event planning, resource allocation, and scheduling.',
  type: 'ReactChampionAgent',
  maxIterations: 20,
});

const venueCoordinatorAgent = new Agent({
  name: 'Sophia Lore',
  role: 'Manages venue logistics.',
  goal: 'Confirm venue availability, arrange setup, and handle issues.',
  background: `Knowledge of venue layouts, policies, and equipment setup.`,
  type: 'ReactChampionAgent',
  tools: [searchInternetTool],
});

const cateringAgent = new Agent({
  name: 'Maxwell Journey',
  role: 'Organizes food and beverages for the event',
  goal: `Deliver a catering plan and coordinate with vendors`,
  background: `Experience with catering contracts, menu planning, and dietary requirements`,
  type: 'ReactChampionAgent',
});

const marketingAgent = new Agent({
  name: 'Riley Morgan',
  role: 'Promotes the event and handles attendee registrations',
  goal: `Drive attendance and manage guest lists`,
  background: `Skilled in social media marketing, email campaigns, and analytics`,
  type: 'ReactChampionAgent',
});

// Define tasks with dynamic input placeholders
const selectEventDateTask = new Task({
  id: 'selectEventDateTask',
  name: 'Select Event Date',
  description: `Evaluates possible event dates based on key stakeholder availability, venue schedules, and other constraints like holidays`,
  expectedOutput: `Selected event date. 
  Rationale for the chosen date. 
  Notes on any potential conflicts or considerations.`,
  agent: eventManagerAgent,
});

const bookVenueTask = new Task({
  id: 'bookVenueTask',
  name: 'Book Venue',
  description: `Contact the venue, confirms availability for the selected date, and handles booking formalities`,
  expectedOutput: `
  Venue name and address.
  Confirmation details
  Cost estimate.
  Any notes on policies or special arrangements.
  `,
  agent: venueCoordinatorAgent,
  dependsOn: ['selectEventDateTask'],
});

const finalizeGuestListTask = new Task({
  id: 'finalizeGuestListTask',
  name: 'Finalize Guest List',
  description: `Compile a guest list by integrating RSVPs, VIP requests, and corporate contacts`,
  expectedOutput: `
  Number of confirmed guests.
Guest list with contact details.
Special dietary or accessibility requirements.
  `,
  agent: marketingAgent,
  dependsOn: ['selectEventDateTask'],
});

const createCateringPlanTask = new Task({
  id: 'createCateringPlanTask',
  name: 'Create Catering Plan',
  description: `Based on the guest list, create a menu and select a vendor to meet dietary preferences and budget constraints.`,
  expectedOutput: `
  Detailed menu.
Vendor name and contract details.
Total cost estimate.
Notes on special arrangements for individual guests.
  `,
  agent: cateringAgent,
  dependsOn: ['selectEventDateTask', 'finalizeGuestListTask'],
});

const setupMarketingCampaignTask = new Task({
  id: 'setupMarketingCampaignTask',
  name: 'Setup Marketing Campaign',
  description: `Develop a marketing plan to promote the event, including social media, email, and PR strategies.`,
  expectedOutput: `
  Marketing plan with key strategies and timelines.
  `,
  agent: cateringAgent,
  dependsOn: ['selectEventDateTask', 'bookVenueTask'],
});

const coordinateVenueSetupTask = new Task({
  id: 'coordinateVenueSetupTask',
  name: 'Coordinate Venue Setup',
  description: `Coordinate with venue staff to ensure all necessary preparations are made for the event.`,
  expectedOutput: `
  Venue setup schedule and checklist.
  Any notes on special arrangements or last-minute details.
  `,
  agent: venueCoordinatorAgent,
  dependsOn: ['bookVenueTask', 'createCateringPlanTask'],
});

const executeMarketingCampaignTask = new Task({
  id: 'executeMarketingCampaignTask',
  name: 'Execute Marketing Campaign',
  description: `Execute the marketing plan, including social media, email, and PR strategies.`,
  expectedOutput: `
  Marketing campaign execution report.
  Any notes on campaign performance or feedback.
  `,
  agent: marketingAgent,
  dependsOn: ['setupMarketingCampaignTask'],
});

const finalizeInspectionAndApprovalTask = new Task({
  id: 'finalizeInspectionAndApprovalTask',
  name: 'Finalize Inspection and Approval',
  description: `Finalize inspection and approval of the event setup.`,
  expectedOutput: `
  Inspection report.
  Any notes on final adjustments or feedback.
  `,
  agent: eventManagerAgent,
  dependsOn: ['coordinateVenueSetupTask', 'executeMarketingCampaignTask'],
});

// Team to coordinate the agents, with dynamic inputs
const team = new Team({
  name: 'Event Planning Team',
  agents: [
    eventManagerAgent,
    venueCoordinatorAgent,
    cateringAgent,
    marketingAgent,
  ],
  tasks: [
    selectEventDateTask,
    bookVenueTask,
    finalizeGuestListTask,
    createCateringPlanTask,
    setupMarketingCampaignTask,
    coordinateVenueSetupTask,
    executeMarketingCampaignTask,
    finalizeInspectionAndApprovalTask,
  ],
  logLevel: 'error',
  inputs: {}, // Actual dynamic inputs
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY }, // Environment variables for the team,
});

module.exports = team;
