// GreenBuddy (Venonto) bot specification — journeys, fields, tags, approved answers.
// Source: "Chatbot Spec v1: Terrace Gardening / Hydroponics / RAS Fish Farming" (Nov 2026).
// This file is the single source of truth for both the bot prompt and the CRM UI.

const SERVICES = [
  { id: 'terrace', label: 'Terrace / Balcony Gardening', short: 'Terrace', tone: 'green' },
  { id: 'hydroponics', label: 'Hydroponics', short: 'Hydroponics', tone: 'teal' },
  { id: 'ras', label: 'RAS Fish Farming', short: 'RAS', tone: 'blue' },
  { id: 'microgreens', label: 'Microgreens', short: 'Microgreens', tone: 'green' },
  { id: 'polyhouse', label: 'Polyhouse Setup', short: 'Polyhouse', tone: 'yellow' },
  { id: 'support', label: 'Support for my existing setup', short: 'Support', tone: 'purple' },
  { id: 'other', label: 'Something else', short: 'Other', tone: 'gray' },
];

// Lead status = CRM pipeline stage
const STATUSES = [
  { id: 'new', name: 'New enquiry', tone: 'gray' },
  { id: 'started', name: 'Started', tone: 'blue' },
  { id: 'qualified', name: 'Qualified', tone: 'purple' },
  { id: 'visit_requested', name: 'Visit / call requested', tone: 'yellow' },
  { id: 'handed', name: 'Handed to sales', tone: 'teal' },
  { id: 'won', name: 'Won', tone: 'green' },
  { id: 'lost', name: 'Lost', tone: 'red' },
];
const STATUS_RANK = { new: 0, started: 1, qualified: 2, visit_requested: 3, handed: 4, won: 5, lost: 5 };

const AREA_TERRACE = ['Below 200 sqft', '200 to 500 sqft', '500 to 1,000 sqft', 'Above 1,000 sqft', 'Not sure'];
const AREA_BALCONY = ['Below 50 sqft', '50 to 100 sqft', 'Above 100 sqft', 'Not sure'];

// Every field the bot may capture. `options` are the exact button labels from the spec.
const FIELDS = {
  name: { label: 'Name', ask: 'May I know your name?' },
  service: { label: 'Service' },
  spaceType: { label: 'Type of space', ask: 'Where would you like to set up your garden?', options: ['Terrace / Open rooftop', 'Balcony', 'Backyard / Ground space', 'Other'] },
  location: { label: 'Location', ask: 'Which city and area is the property in? For example, Hyderabad, Kukatpally.' },
  area: { label: 'Available area', ask: 'Roughly how much space do you have?', options: AREA_TERRACE, note: `Balcony options instead: ${AREA_BALCONY.join(' / ')}` },
  grow: { label: 'What to grow', ask: 'What would you like to grow?', options: ['Vegetables', 'Flowers and ornamental plants', 'Fruits', 'Mix of vegetables, fruits and flowers', 'Still exploring', 'Upgrade my existing garden'], note: 'Balcony options instead: Vegetables / Mix of plants / Still exploring / Upgrade my existing garden' },
  currentSetup: { label: 'Current setup', derived: true },
  // Hydroponics
  hydroPlan: { label: 'Planning', ask: 'Great! We set up hydroponic systems like towers, Dutch bucket systems, NFT channels and DWC systems. What are you planning?', options: ['Grow vegetables at home', 'Start a commercial hydroponic farm', 'Hydroponic training', 'Visit a hydroponic farm', 'Just exploring'] },
  hydroSpace: { label: 'Type of space', ask: 'Where would you like to set it up?', options: ['Terrace / Open rooftop', 'Balcony', 'Indoors', 'Other'] },
  hydroGrow: { label: 'What to grow', ask: 'What would you like to grow?', options: ['Leafy greens (lettuce, spinach, basil and similar)', 'Fruiting vegetables', 'A mix', 'Not sure yet'] },
  landSize: { label: 'Land / space', ask: 'How much space do you have for the farm?', options: ['Below 2,000 sqft', '2,000 to 5,000 sqft', '5,000 sqft to 1 acre', 'Above 1 acre', 'Not sure'], note: 'Accept acres, guntas, cents or sqft and store as given.' },
  currentSite: { label: 'Current site', ask: 'What does the site look like right now?', options: ['Open land', 'Polyhouse or net house already built', 'Rooftop or building', 'Not decided yet'] },
  investment: { label: 'Investment readiness', ask: 'How far along are you with funding for the project?', options: ['Funds are ready', 'Arranging funds (loan or subsidy)', 'No budget planned yet'] },
  timeline: { label: 'Timeline', ask: 'When would you like the setup to be ready?', options: ['Within 1 month', '1 to 3 months', '3 to 6 months', 'Just researching for now'] },
  decisionMaker: { label: 'Decision maker', ask: 'Will you be making the final decision on this project?', options: ["Yes, it's my decision", 'Together with partners or family', "I'm enquiring for someone else"] },
  otherContact: { label: 'Decision maker contact', ask: 'Could you share their name and number so our team can speak with them too?' },
  trainingFor: { label: 'Training for', ask: 'Our team runs hydroponic training. Is this for you personally, or for a group or institution?', options: ['Just me', 'A group or institution'] },
  comingFrom: { label: 'Coming from', ask: 'Our team will share the next available slot. Which city are you coming from?' },
  // RAS
  rasLocation: { label: 'Site location', ask: 'Which state and district is the site in? For example, Nalgonda, Telangana.' },
  abroad: { label: 'Customer based abroad' },
  landOwnership: { label: 'Land ownership', ask: 'Do you own the land for this project?', options: ['Yes, I own it', 'Leased or family land', 'Not yet'] },
  rasLand: { label: 'Land size', ask: 'Roughly how much land is available?', options: ['Below 0.5 acre', '0.5 to 1 acre', '1 to 3 acres', 'Above 3 acres', 'Not sure'] },
  waterSource: { label: 'Water source', ask: 'What is your water source?', options: ['Borewell', 'Canal, river or pond', 'Open well', 'Not sure'] },
  waterYearRound: { label: 'Water all year', ask: 'Is water available all year?', options: ['Yes', 'No, seasonal', 'Not sure'] },
  power: { label: 'Power', ask: 'Is electricity available at the site, and how steady is it?', options: ['24 hours', 'Regular power cuts', 'No power yet', 'Not sure'] },
  wasteWater: { label: 'Waste water', ask: 'Where will the waste water go? Do you have at least half an acre of farm land nearby to take it?', options: ['Yes, my own farm land', 'Yes, nearby farm land', 'No, surrounded by houses', 'Not sure'] },
  fish: { label: 'Fish', ask: 'Which fish do you want to grow?', options: ['Tilapia', 'Pangasius (pangas)', 'Murrel (snakehead)', 'Singhi or Magur', 'Sea bass or Barramundi', 'Prawns or shrimp', 'Not decided', 'Other'] },
  market: { label: 'Market checked', ask: 'Have you checked who will buy it and at what price per kg?', options: ['Yes, I have buyers or a price', 'Not yet', 'Not sure'] },
  experience: { label: 'Experience', ask: 'Have you farmed fish before?', options: ['Never', 'A little, small pond or tank', 'Yes, I run a farm'] },
  funding: { label: 'Funding', ask: 'How do you plan to fund the project?', options: ['Own funds', 'Bank loan', 'Own funds and loan', 'Need subsidy support', 'Not decided'] },
  budget: { label: 'Budget band', ask: 'Roughly what budget do you have in mind?', options: ['Below 10 lakh', '10 to 25 lakh', '25 to 50 lakh', 'Above 50 lakh', 'Not decided'] },
  target: { label: 'Production target', ask: 'How much do you want to produce in a year?', options: ['Below 5 tons', '5 to 20 tons', '20 to 50 tons', 'Above 50 tons', 'Not sure'] },
  start: { label: 'Start', ask: 'When would you like to start?', options: ['Within 3 months', '3 to 6 months', 'After 6 months', 'Just exploring'] },
  salinity: { label: 'Water salinity', ask: 'What is the salinity of your water? If you are not sure, a quick test will tell us.' },
  callTime: { label: 'Preferred call time', options: ['Morning (10 AM to 1 PM)', 'Afternoon (1 PM to 6 PM)', 'Any time in working hours'] },
  callLanguage: { label: 'Call language', options: ['English', 'Telugu', 'Hindi', 'Other'] },
  // Site visit / generic
  feeConsent: { label: 'Visit fee consent', options: ['Yes, go ahead', 'I have a question', 'Not right now'] },
  siteAddress: { label: 'Site address (typed)' },
  need: { label: 'Requirement' },
};
const FIELD_KEYS = Object.keys(FIELDS).filter((k) => !FIELDS[k].derived && k !== 'abroad');
// Short WhatsApp row titles for long labels (WhatsApp list rows allow 24 chars)
const SHORT = { 'Mix of vegetables, fruits and flowers': 'Mix: veg, fruit, flowers', 'Flowers and ornamental plants': 'Flowers & ornamentals', 'Leafy greens (lettuce, spinach, basil and similar)': 'Leafy greens' };

// Questions each journey needs before the lead is "Qualified", in the order they are asked.
const JOURNEYS = {
  menu: { label: 'Service menu', required: [] },
  terrace: { label: 'Terrace / Balcony', service: 'terrace', required: ['name', 'spaceType', 'location', 'area', 'grow'] },
  hydro_home: { label: 'Hydroponics · Home', service: 'hydroponics', required: ['name', 'hydroPlan', 'hydroSpace', 'location', 'area', 'hydroGrow'] },
  hydro_commercial: { label: 'Hydroponics · Commercial', service: 'hydroponics', required: ['name', 'hydroPlan', 'location', 'landSize', 'currentSite', 'investment', 'timeline', 'decisionMaker'] },
  hydro_training: { label: 'Hydroponics · Training', service: 'hydroponics', required: ['name', 'hydroPlan', 'trainingFor'] },
  hydro_visit: { label: 'Hydroponics · Farm visit', service: 'hydroponics', required: ['name', 'hydroPlan', 'comingFrom'] },
  hydro_exploring: { label: 'Hydroponics · Exploring', service: 'hydroponics', required: ['name', 'hydroPlan'] },
  hydro_unknown: { label: 'Hydroponics', service: 'hydroponics', required: ['name', 'hydroPlan'] },
  ras: { label: 'RAS Fish Farming', service: 'ras', required: ['name', 'rasLocation', 'landOwnership', 'rasLand', 'waterSource', 'waterYearRound', 'power', 'wasteWater', 'fish', 'market', 'experience', 'funding', 'budget', 'target', 'start'] },
  generic: { label: 'General enquiry', required: ['name', 'location', 'need'] },
  support: { label: 'Support', service: 'support', required: ['name', 'need'] },
};

const NEXT_STEPS = {
  site_visit: 'Book a site visit',
  callback: 'Get a call back',
  project_videos: 'See past projects',
  exploring: 'Just exploring',
  project_team: 'Talk to our project team',
  expert_call: 'Talk to our expert',
  subsidy_help: 'Subsidy and loan help',
  not_now: 'Not right now (visit fee)',
};

const TAGS = {
  shared: ['Site Visit Requested', 'Expert Call Requested', 'Callback Required', 'Project Videos Required', 'Quotation Required', 'Technical / Sales Review', 'Exploratory Lead', 'Warm', 'Support Request', 'Loan / Subsidy Support'],
  hydroponics: ['Polyhouse Interest'],
  ras: ['No Land', 'Discharge Risk', 'Power Risk', 'Market Unverified', 'Species Open', 'Prawns', 'Murrel Simple Tank', 'Salinity Check', 'Small Budget', 'Phase Plan Suggested', 'Farm Visit Request'],
};
const ALL_TAGS = [...new Set([...TAGS.shared, ...TAGS.hydroponics, ...TAGS.ras])];
// Tags the model may add from conversation judgement (the rest are computed in code)
const MODEL_TAGS = ['Quotation Required', 'Technical / Sales Review', 'Exploratory Lead', 'Warm', 'Support Request', 'Salinity Check', 'Farm Visit Request', 'Loan / Subsidy Support'];

const TASK_TYPES = ['Support Request', 'Callback Required', 'Project Videos Required', 'Site Visit Request', 'Expert Call', 'Consultation Call', 'Subsidy Support', 'Training Enquiry', 'Farm Visit Request', 'Team Question', 'Hot Lead'];
const MODEL_TASKS = ['Support Request', 'Consultation Call', 'Subsidy Support', 'Training Enquiry', 'Farm Visit Request', 'Team Question', 'Callback Required'];

// Approved answers ("the bot answers only from this approved list") — editable in the CRM
const DEFAULT_FAQ = [
  { service: 'terrace', q: 'How much will it cost?', a: 'Cost depends on your space, the system and what you grow. Our team gives an exact quote after the site visit. (Then offer the site visit or a call back.)' },
  { service: 'terrace', q: 'How much water does it save?', a: 'Our terrace systems typically use 80 to 90% less water than regular gardening.' },
  { service: 'terrace', q: 'What kind of setup do you use?', a: 'Dutch buckets, modular planters, grow beds and towers, depending on the space. (Never mention grow bags.)' },
  { service: 'terrace', q: 'I want a custom design', a: 'Tag Technical / Sales Review and offer a call back.' },
  { service: 'all', q: 'I need a detailed quotation', a: 'Tag Quotation Required. Explain that a site visit (terrace/hydroponics) or the expert call (RAS) comes first.' },
  { service: 'hydroponics', q: 'How much does a setup cost?', a: 'It depends on the size, the system and the crops. Our team shares an exact quote after understanding your site. (Offer a call or site visit.)' },
  { service: 'hydroponics', q: 'What returns can I expect?', a: 'Returns depend on crop, size and market. Our project team can walk you through realistic numbers for your site. (Create a Consultation Call task. Never give ROI or payback numbers.)' },
  { service: 'hydroponics', q: 'Is there a government subsidy?', a: 'There are schemes that may apply depending on your location and project. Our team can guide you. (Never promise a subsidy or an amount.)' },
  { service: 'hydroponics', q: 'Do you buy back the produce?', a: 'We have a buyback policy — our team can guide you.' },
  { service: 'hydroponics', q: 'How much water does hydroponics save?', a: 'No approved figure yet — route to the team. Do NOT reuse the terrace 80 to 90% figure.' },
  { service: 'hydroponics', q: 'Do you sell fresh hydroponic vegetables?', a: 'Route to sales (create a Team Question task).' },
  { service: 'ras', q: 'What is RAS?', a: 'RAS stands for Recirculating Aquaculture System. Fish are grown in tanks where the water is circulated and cleaned continuously.' },
  { service: 'ras', q: 'How much will it cost?', a: 'Cost depends on the fish, the size of the farm and your site. Our team shares a proper estimate after understanding your plan. (Then offer the expert call.)' },
  { service: 'ras', q: 'Which fish is best?', a: 'It depends on your region and what sells locally. Our team will suggest options once we know your location and market.' },
  { service: 'ras', q: 'Do I need RAS for murrel?', a: 'Murrel can be grown in a simpler tank system with daily water change, so a full RAS is not needed for it.' },
  { service: 'ras', q: 'Is there a government subsidy?', a: 'Several schemes support fish farming, such as PMMSY, PMEGP, FIDF and NFDB. What you qualify for depends on your state and project. Our team can explain this on the call.' },
  { service: 'ras', q: 'How many tanks or how much land do I need?', a: 'It depends on the fish and your production target. Our team will work this out with you.' },
  { service: 'ras', q: 'Can you prepare the project report (DPR)?', a: "Good question! Let me get our team to answer that. (Create a Subsidy Support task.)" },
  { service: 'ras', q: 'Do you help sell the fish or buy it back?', a: "Good question! Let me get our team to answer that. (Create a Team Question task.)" },
  { service: 'ras', q: 'Can I visit a running farm?', a: "Good question! Let me get our team to answer that. (Tag Farm Visit Request and create a Farm Visit Request task.)" },
  { service: 'all', q: 'Technical question not on this list', a: "Good question! Let me get our team to answer that. (Create a Team Question task.)" },
  { service: 'all', q: 'Anything unrelated to Venonto', a: "I can only help with Venonto's gardening and farming services. Shall we continue with your plan?" },
];

const DEFAULT_BOT_SETTINGS = {
  botName: 'GreenBuddy',
  company: 'Venonto',
  replyLanguage: 'English',
  siteVisitCity: 'Hyderabad',
  siteVisitFee: 500,
  workStart: '10:00',
  workEnd: '18:00',
  workDays: [1, 2, 3, 4, 5, 6],
  faq: DEFAULT_FAQ,
};

module.exports = { SERVICES, STATUSES, STATUS_RANK, FIELDS, FIELD_KEYS, SHORT, JOURNEYS, NEXT_STEPS, TAGS, ALL_TAGS, MODEL_TAGS, TASK_TYPES, MODEL_TASKS, DEFAULT_FAQ, DEFAULT_BOT_SETTINGS, AREA_BALCONY, AREA_TERRACE };
