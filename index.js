require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const { saveStudyTime, getSettings } = require('./settings');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let studyTimes = {};
const activeSessions = {};
const sessionMonitors = {};

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await registerSlashCommands();
    console.log(studyTimes);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    const guildId = interaction.guild.id;

    if (interaction.commandName === 'study') {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply('You need to be in a voice channel to start studying!');
        }

        if (!studyTimes[guildId]) studyTimes[guildId] = {};
        if (!activeSessions[guildId]) activeSessions[guildId] = new Set();

        if (!studyTimes[guildId][member.id]) {
            console.log(studyTimes);
            console.log(studyTimes[guildId][member.id]);
            console.log('didnt find so its now zero');
            studyTimes[guildId][member.id] = { studyTime: 0, interval: null, connection: null };
        } else {
            console.log(studyTimes);
            console.log('found it');
        }


        const studyData = studyTimes[guildId][member.id];
        studyData.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });

        studyData.interval = setInterval(() => {
            studyData.studyTime += 1;
            console.log(studyData.studyTime);
        }, 1000);

        activeSessions[guildId].add(member.id);

        if (!sessionMonitors[guildId]) {
            const expectedChannelId = voiceChannel.id;

            sessionMonitors[guildId] = setInterval(() => {
                const botVC = interaction.guild.members.me.voice.channel;
                const stillValid = botVC && botVC.id === expectedChannelId;

                const usersInVC = botVC?.members.filter(member =>
                    activeSessions[guildId]?.has(member.id)
                ) || new Map();

                console.log(usersInVC.size);

                // Remove users who are no longer in VC
                const trackedUsers = Object.keys(studyTimes[guildId] || {});
                trackedUsers.forEach(userId => {
                    console.log(usersInVC.has(userId));
                    const stillInVC = usersInVC.has(userId);
                    if (!stillInVC) {
                        const data = studyTimes[guildId][userId];
                        if (data) {
                            clearInterval(data.interval);
                            saveStudyTime(guildId, userId, data.studyTime);
                            console.log(`👋 Removed ${userId}, saved ${data.studyTime}s`);
                            delete studyTimes[guildId][userId];
                        }

                        activeSessions[guildId]?.delete(userId);
                    }
                });

                // End session if no users left
                if (!stillValid || usersInVC.size === 0) {
                    console.log("end session nobody in call");
                    clearInterval(sessionMonitors[guildId]);
                    delete sessionMonitors[guildId];

                    const reason = !botVC
                        ? 'Bot disconnected'
                        : botVC.id !== expectedChannelId
                            ? 'Bot moved channels'
                            : 'No users left';

                    console.log(`📴 ${reason}. Ended all sessions in guild ${guildId}`);
                    studyData.connection.destroy();
                    activeSessions[guildId]?.clear();
                }
            }, 5000); // Monitor every 5 seconds
        }

        await interaction.reply(`Started tracking your study time in ${voiceChannel.name}`);
    }

    if (interaction.commandName === 'pomodoro') {
        const member = interaction.member;
        const { studyTime } = studyTimes[guildId]?.[member.id] || { studyTime: 0 };
        const studyDuration = 25 * 60;
        const breakDuration = 5 * 60;

        if (studyTime > 0) {
            setTimeout(() => {
                interaction.followUp('Pomodoro session completed! Take a 5-minute break.');
            }, studyDuration * 1000);
        }

        setTimeout(() => {
            interaction.followUp('Break time is over! Get back to studying.');
        }, (studyDuration + breakDuration) * 1000);

        await interaction.reply(`Pomodoro timer started! Work for 25 minutes, then take a 5-minute break.`);
    }

    if (interaction.commandName === 'mystats') {
        const member = interaction.member;
        const studyData = studyTimes[guildId]?.[member.id] || { studyTime: 0 };

        const hours = Math.floor(studyData.studyTime / 3600);
        const minutes = Math.floor((studyData.studyTime % 3600) / 60);
        const seconds = studyData.studyTime % 60;

        await interaction.reply(`${member.user.username}'s study time: ${hours}h ${minutes}m ${seconds}s`);
    }

    if (interaction.commandName === 'leaderboards') {
        const leaderboard = Object.keys(studyTimes[guildId] || {}).map(userId => {
            const studyData = studyTimes[guildId][userId];
            const hours = Math.floor(studyData.studyTime / 3600);
            const minutes = Math.floor((studyData.studyTime % 3600) / 60);
            const seconds = studyData.studyTime % 60;
            return {
                user: client.users.cache.get(userId),
                time: `${hours}h ${minutes}m ${seconds}s`,
                totalSeconds: studyData.studyTime
            };
        });

        leaderboard.sort((a, b) => b.totalSeconds - a.totalSeconds);

        let leaderboardMessage = 'Leaderboard:\n';
        leaderboard.forEach((entry, index) => {
            leaderboardMessage += `${index + 1}. ${entry.user?.username || 'Unknown'}: ${entry.time}\n`;
        });

        await interaction.reply(leaderboardMessage);
    }
});

async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('study')
            .setDescription('Start tracking study time in a voice channel'),
        new SlashCommandBuilder()
            .setName('pomodoro')
            .setDescription('Start a Pomodoro session for studying'),
        new SlashCommandBuilder()
            .setName('mystats')
            .setDescription('View your own study time stats'),
        new SlashCommandBuilder()
            .setName('leaderboards')
            .setDescription('View the leaderboard of total study time')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('Slash commands registered.');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
}

client.login(process.env.TOKEN);
