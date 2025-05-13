require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource} = require('@discordjs/voice');
const { saveStudyTime, getSettings } = require('./settings');
const {join} = require("node:path");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let guildInfo = getSettings();
let studyTimes = {};
const activeSessions = {};
const sessionMonitors = {};
const interactionRecords = {};
const pomodoroTimers = {};

// --- PLAY SOUND FUNCTION ---
async function playSoundInChannel(voiceChannel) {
    if (!voiceChannel) return;

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });

    const player = createAudioPlayer();
    const fileName = 'notification1.mp3';
    const resource = createAudioResource(join(__dirname, 'public', 'sounds', fileName));

    connection.subscribe(player);
    player.play(resource);

    const timeout = setTimeout(() => {
        player.stop()
    }, 195 * 1000);
    clearTimeout(timeout);
}

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await registerSlashCommands();
    console.log(studyTimes);
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        const [action, userId] = interaction.customId.split(':');
        const guildId = interaction.guildId;

        if (action === 'leave' && interaction.user.id === userId) {
            const studyData = studyTimes[guildId]?.[userId];
            if (studyData) {
                clearInterval(studyData.interval);
                saveStudyTime(guildId, userId, studyData.studyTime);
                activeSessions[guildId]?.delete(userId);
                delete studyTimes[guildId][userId];

                const h = Math.floor(studyData.studyTime / 3600);
                const m = Math.floor((studyData.studyTime % 3600) / 60);
                const s = studyData.studyTime % 60;
                const formattedTime = `${h > 0 ? `${h}h ` : ''}${m}m ${s}s`;

                const oldReply = interactionRecords[guildId]?.[userId];
                if (oldReply) {
                    await oldReply.edit({
                        content: `👋 You have left the study session after ${formattedTime}.`,
                        components: []
                    });
                }

                await interaction.deferUpdate();
            } else {
                await interaction.reply({ content: `❌ You're not in a tracked session.` });
            }
        }
        return;
    }

    if (!interaction.isCommand()) return;
    const guildId = interaction.guild.id;

    if (interaction.commandName === 'study') {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply('You need to be in a voice channel to start studying!');
        }

        const botVC = interaction.guild.members.me.voice.channel;
        if (botVC && botVC.id !== voiceChannel.id) {
            return interaction.reply({
                content: `🎓 A study session is already ongoing in another voice channel. Please join that session to be tracked.`
            });
        }

        if (!studyTimes[guildId]) studyTimes[guildId] = {};
        if (!activeSessions[guildId]) activeSessions[guildId] = new Set();
        if (!interactionRecords[guildId]) interactionRecords[guildId] = {};

        if (!studyTimes[guildId][member.id]) {
            studyTimes[guildId][member.id] = { studyTime: 0, interval: null, connection: null };
        }

        const studyData = studyTimes[guildId][member.id];
        studyData.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });

        studyData.interval = setInterval(() => {
            studyData.studyTime += 1;
        }, 1000);

        activeSessions[guildId].add(member.id);

        if (!sessionMonitors[guildId]) {
            const expectedChannelId = voiceChannel.id;

            sessionMonitors[guildId] = setInterval(async () => {
                const botVC = interaction.guild.members.me.voice.channel;
                const stillValid = botVC && botVC.id === expectedChannelId;

                const usersInVC = botVC?.members.filter(member =>
                    activeSessions[guildId]?.has(member.id)
                ) || new Map();

                const trackedUsers = Object.keys(studyTimes[guildId] || {});
                for (const userId of trackedUsers) {
                    const stillInVC = usersInVC.has(userId);
                    if (!stillInVC) {
                        const data = studyTimes[guildId][userId];
                        if (data) {
                            clearInterval(data.interval);
                            saveStudyTime(guildId, userId, data.studyTime);

                            const h = Math.floor(data.studyTime / 3600);
                            const m = Math.floor((data.studyTime % 3600) / 60);
                            const s = data.studyTime % 60;
                            const formattedTime = `${h > 0 ? `${h}h ` : ''}${m}m ${s}s`;

                            const oldReply = interactionRecords[guildId]?.[userId];
                            if (oldReply) {
                                await oldReply.edit({
                                    content: `👋 You have left the study session after ${formattedTime}.`,
                                    components: []
                                });
                            }

                            delete studyTimes[guildId][userId];
                        }
                        activeSessions[guildId]?.delete(userId);
                    }
                }

                if (!stillValid || usersInVC.size === 0) {
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
            }, 5000);
        }

        const leaveButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`leave:${member.id}`)
                .setLabel('Leave the session')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            content: `✅ Started tracking your study time in **${voiceChannel.name}**.`,
            components: [leaveButton]
        });

        interactionRecords[guildId][member.id] = await interaction.fetchReply();
    }

    if (interaction.commandName === 'pomodoro') {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        const botVC = interaction.guild.members.me.voice.channel;

        if (!botVC || !botVC.id || !studyTimes[guildId]) {
            return interaction.reply({ content: '❌ The bot is not in a study session or not in a voice channel.' });
        }

        if (!botVC || botVC.id !== voiceChannel?.id) {
            return interaction.reply({ content: '❌ You must be in the same voice channel as the bot to start a Pomodoro.' });
        }

        const workTime = parseInt(interaction.options.getInteger('work')) || 25;
        const breakTime = parseInt(interaction.options.getInteger('break')) || 5;

        if (pomodoroTimers[guildId]) {
            clearInterval(pomodoroTimers[guildId].interval);
            clearTimeout(pomodoroTimers[guildId].timeout);
        }

        let totalElapsed = 0;
        let mode = 'work';
        let minutesLeft = workTime;

        const reply = await interaction.reply({
            content: `⏳ Pomodoro started: **${workTime} min work** + **${breakTime} min break**\nElapsed: 0 min\nCurrent mode: 🧠 Work`,
            fetchReply: true
        });

        const updateMessage = async () => {
            totalElapsed++;
            minutesLeft--;

            await interaction.editReply({
                content: `⏳ Pomodoro ongoing: **${workTime} min work** + **${breakTime} min break**\nElapsed: ${totalElapsed} min\nCurrent mode: ${mode === 'work' ? '🧠 Work' : '☕ Break'} (${minutesLeft} min left)`
            });
        };

        const startCycle = async () => {
            const stillInVC = interaction.guild.members.me.voice.channel?.id === voiceChannel.id;
            if (!stillInVC) return;

            await playSoundInChannel(voiceChannel);

            pomodoroTimers[guildId] = {
                interval: setInterval(updateMessage, 60 * 1000),
                timeout: setTimeout(async function cycleEnd() {
                    clearInterval(pomodoroTimers[guildId].interval);

                    // Switch modes
                    mode = mode === 'work' ? 'break' : 'work';
                    minutesLeft = mode === 'work' ? workTime : breakTime;

                    // Update message once immediately after switch
                    await interaction.editReply({
                        content: `⏳ Pomodoro ongoing: **${workTime} min work** + **${breakTime} min break**\nElapsed: ${totalElapsed} min\nCurrent mode: ${mode === 'work' ? '🧠 Work' : '☕ Break'} (${minutesLeft} min left)`
                    });

                    await playSoundInChannel(voiceChannel);

                    // Restart next cycle
                    startCycle();
                }, minutesLeft * 60 * 1000)
            };
        };

        startCycle();
    }


    if (interaction.commandName === 'mystats') {
        const member = interaction.member;
        const studyData = guildInfo[guildId]?.[member.id] || { studyTime: 0 };

        const hours = Math.floor(studyData.studyTime / 3600);
        const minutes = Math.floor((studyData.studyTime % 3600) / 60);
        const seconds = studyData.studyTime % 60;

        await interaction.reply(`${member.user.username}'s study time: ${hours}h ${minutes}m ${seconds}s`);
    }

    if (interaction.commandName === 'leaderboards') {
        const leaderboard = Object.keys(guildInfo[guildId] || {}).map(userId => {
            const studyData = guildInfo[guildId][userId];
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
            .setDescription('Start a Pomodoro session for studying')
            .addIntegerOption(opt =>
                opt.setName('work')
                    .setDescription('Work duration in minutes')
                    .setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName('break')
                    .setDescription('Break duration in minutes')
                    .setRequired(true)
            ),
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
