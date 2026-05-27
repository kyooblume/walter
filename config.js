// ----- Colour scheme for each phase -----
export const PHASE_COLORS = [
  { bg: '#E6F1FB', border: '#185FA5', text: '#0C447C' },
  { bg: '#FAECE7', border: '#993C1D', text: '#712B13' },
  { bg: '#EAF3DE', border: '#3B6D11', text: '#27500A' },
  { bg: '#EEEDFE', border: '#534AB7', text: '#3C3489' },
  { bg: '#FAEEDA', border: '#BA7517', text: '#633806' },
];

// Surfaced in the About page; bumped whenever a release ships. (Task 4.3)
export const VERSION = '1.1.0';

export const appState = {
 parsedPhases: null, // Stores parsed phase data so settings changes can trigger recalculation without re-uploading
 parsedAllValid: null, // Stores all valid rows across all phases // Chart.js instance for the Poincaré plot
 summaryData: [],
 phaseLabels: {},
 outputResults: [],
 batchResults: [],
 demographics: new Map(),
 demographicFields: ['Age', 'Gender']
};