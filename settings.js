const fs = require('fs');
const path = require('path');
const SETTINGS_PATH = path.join(__dirname, 'guildSettings.json');

// Initialize the settings file if it doesn't exist
if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ data: {} }, null, 2), 'utf8');
}

let settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));

// Load saved study times and build the in-memory studyTimes object
function getSettings() {
    const result = {};
    if (!settings.data) return result;

    for (const guildId in settings.data) {
        result[guildId] = {};
        for (const memberId in settings.data[guildId]) {
            result[guildId][memberId] = {
                studyTime: settings.data[guildId][memberId].timestudied,
                interval: null,
                connection: null
            };
        }
    }
    return result;
}

// Save and accumulate study time for a user
function saveStudyTime(guildId, memberId, sessionTime) {
    if (!settings.data) settings.data = {};
    if (!settings.data[guildId]) settings.data[guildId] = {};

    const previous = settings.data[guildId][memberId]?.timestudied || 0;

    settings.data[guildId][memberId] = {
        timestudied: previous + sessionTime
    };

    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = {
    getSettings,
    saveStudyTime
};
