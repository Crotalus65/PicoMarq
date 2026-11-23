// Launches the actual application with deterministic native-dialog responses.
// This harness is test-only and is not included in the Windows runtime.
const { dialog } = require('electron');
global.startupPrompts = [];
global.startupErrors = [];
global.startupResponses = JSON.parse(process.env.PICOMARQ_STARTUP_TEST_RESPONSES || '[]');
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  global.startupPrompts.push(options);
  return { response: global.startupResponses.length ? global.startupResponses.shift() : options.title === 'Recover Unsaved Work' ? 0 : 1 };
};
dialog.showErrorBox = (title, message) => global.startupErrors.push({ title, message });
require('../desktop/main.cjs');
