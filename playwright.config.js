module.exports = { testDir: 'tests', use: { baseURL: 'http://localhost:4173', ...require('@playwright/test').devices['Pixel 7'] },
  webServer: { command: 'python3 -m http.server 4173', port: 4173, reuseExistingServer: true } };
