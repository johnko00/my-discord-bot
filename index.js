// 必要なライブラリを読み込み
const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { Client: NotionClient } = require('@notionhq/client');
const express = require('express');
require('dotenv').config();

// Notionクライアントの初期化
const notion = new NotionClient({
    auth: process.env.NOTION_TOKEN,
});

// ボットクライアントの作成
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// スラッシュコマンドの定義
const commands = [
    {
        name: 'ping',
        description: 'ボットの応答速度を確認します'
    },
    {
        name: 'hello',
        description: '挨拶をします',
        options: [
            {
                name: 'user',
                description: '挨拶する相手を選択（省略可能）',
                type: 6,
                required: false
            }
        ]
    },
    {
        name: 'serverinfo',
        description: 'サーバーの情報を表示します'
    },
    {
        name: 'add-notion',
        description: 'NotionにTRPG卓情報を追加します'
    }
];

// TRPGシナリオの選択肢（サンプル - 実際のデータベースから取得することも可能）
const TRPG_SCENARIOS = [
    { label: 'クトゥルフ神話TRPG', value: 'cthulhu' },
    { label: 'ソード・ワールド2.5', value: 'sw25' },
    { label: 'ダンジョンズ&ドラゴンズ', value: 'dnd' },
    { label: 'シノビガミ', value: 'shinobigami' },
    { label: 'インセイン', value: 'insane' },
    { label: 'その他', value: 'other' }
];

// ボット起動時の処理
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がオンラインになりました！`);
    console.log(`🔗 ${client.guilds.cache.size}個のサーバーに接続中`);

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    
    try {
        console.log('🗑️ 古いコマンドを削除中...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [] }
        );
        console.log('✅ 古いコマンド削除完了！');
        
        console.log('🔄 新しいコマンドを登録中...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ 新しいコマンド登録完了！');
    } catch (error) {
        console.error('❌ コマンド処理エラー:', error);
    }
});

// スラッシュコマンドが実行された時の処理
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        try {
            switch (commandName) {
                case 'ping':
                    const ping = client.ws.ping;
                    await interaction.reply(`🏓 Pong! レイテンシ: ${ping}ms`);
                    break;

                case 'hello':
                    const user = interaction.options.getUser('user');
                    const message = user
                        ? `👋 こんにちは、${user}さん！`
                        : `👋 こんにちは、${interaction.user}さん！`;
                    await interaction.reply(message);
                    break;

                case 'serverinfo':
                    const guild = interaction.guild;
                    const embed = new EmbedBuilder()
                        .setColor(0x0099ff)
                        .setTitle('📊 サーバー情報')
                        .setThumbnail(guild.iconURL())
                        .addFields(
                            { name: '🏷️ サーバー名', value: guild.name, inline: true },
                            { name: '👥 メンバー数', value: guild.memberCount.toString(), inline: true },
                            { name: '📅 作成日', value: guild.createdAt.toLocaleDateString('ja-JP'), inline: true },
                            { name: '🎭 ロール数', value: guild.roles.cache.size.toString(), inline: true },
                            { name: '📺 チャンネル数', value: guild.channels.cache.size.toString(), inline: true }
                        )
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                    break;

                case 'add-notion':
                    try {
                        console.log('🎲 add-notion コマンドが実行されました');
                        
                        // フォーム表示
                        const modal = new ModalBuilder()
                            .setCustomId('notion_trpg_modal')
                            .setTitle('🎲 TRPG卓情報をNotionに追加');

                        // 卓名入力
                        const tableNameInput = new TextInputBuilder()
                            .setCustomId('table_name')
                            .setLabel('卓名')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('例: 第1回クトゥルフ卓')
                            .setRequired(true)
                            .setMaxLength(100);

                        // 日付入力
                        const dateInput = new TextInputBuilder()
                            .setCustomId('session_date')
                            .setLabel('開催日（YYYY-MM-DD形式）')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('例: 2025-06-25')
                            .setRequired(true)
                            .setMaxLength(10);

                        // GM入力
                        const gmInput = new TextInputBuilder()
                            .setCustomId('gm_names')
                            .setLabel('GM（複数の場合はカンマ区切り）')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('例: やすかわ, 田中')
                            .setRequired(true)
                            .setMaxLength(200);

                        // PL入力
                        const plInput = new TextInputBuilder()
                            .setCustomId('pl_names')
                            .setLabel('PL（複数の場合はカンマ区切り）')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('例: 佐藤, 鈴木, 高橋, 伊藤')
                            .setRequired(false)
                            .setMaxLength(500);

                        // ActionRowを作成
                        const firstActionRow = new ActionRowBuilder().addComponents(tableNameInput);
                        const secondActionRow = new ActionRowBuilder().addComponents(dateInput);
                        const thirdActionRow = new ActionRowBuilder().addComponents(gmInput);
                        const fourthActionRow = new ActionRowBuilder().addComponents(plInput);

                        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);

                        console.log('🎲 モーダルを表示します...');
                        await interaction.showModal(modal);
                        console.log('✅ モーダル表示完了');

                    } catch (error) {
                        console.error('❌ add-notion コマンドエラー:', error);
                        await interaction.reply({
                            content: '❌ フォーム表示エラー: ' + error.message,
                            ephemeral: true
                        });
                    }
                    break;

                default:
                    await interaction.reply('❌ 未知のコマンドです。');
            }
        } catch (error) {
            console.error('コマンド実行エラー:', error);
            if (interaction.replied) {
                await interaction.followUp('❌ コマンドの実行中にエラーが発生しました。');
            } else {
                await interaction.reply('❌ コマンドの実行中にエラーが発生しました。');
            }
        }
    }

    // モーダル送信時の処理
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'notion_trpg_modal') {
            try {
                await interaction.deferReply({ ephemeral: true });

                const tableName = interaction.fields.getTextInputValue('table_name');
                const sessionDate = interaction.fields.getTextInputValue('session_date');
                const gmNames = interaction.fields.getTextInputValue('gm_names');
                const plNames = interaction.fields.getTextInputValue('pl_names') || '';

                // 日付形式の検証
                if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
                    await interaction.editReply('❌ 日付の形式が正しくありません。YYYY-MM-DD形式で入力してください。');
                    return;
                }

                // TRPGシナリオ選択メニューを表示
                const scenarioSelect = new StringSelectMenuBuilder()
                    .setCustomId('scenario_select')
                    .setPlaceholder('TRPGシナリオを選択してください')
                    .addOptions(TRPG_SCENARIOS);

                const selectRow = new ActionRowBuilder().addComponents(scenarioSelect);

                // 確認ボタン
                const confirmButton = new ButtonBuilder()
                    .setCustomId('confirm_notion_add')
                    .setLabel('✅ Notionに追加')
                    .setStyle(ButtonStyle.Primary);

                const cancelButton = new ButtonBuilder()
                    .setCustomId('cancel_notion_add')
                    .setLabel('❌ キャンセル')
                    .setStyle(ButtonStyle.Secondary);

                const buttonRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                // 確認用Embed
                const confirmEmbed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle('🎲 TRPG卓情報確認')
                    .addFields(
                        { name: '🏷️ 卓名', value: tableName, inline: true },
                        { name: '📅 開催日', value: sessionDate, inline: true },
                        { name: '🎮 GM', value: gmNames, inline: true },
                        { name: '👥 PL', value: plNames || '未設定', inline: false }
                    )
                    .setFooter({ text: 'TRPGシナリオを選択して「Notionに追加」をクリックしてください' });

                // 一時的にデータを保存（実際の実装では、より堅牢な方法を使用することを推奨）
                global.tempNotionData = {
                    userId: interaction.user.id,
                    tableName,
                    sessionDate,
                    gmNames: gmNames.split(',').map(name => name.trim()),
                    plNames: plNames ? plNames.split(',').map(name => name.trim()) : []
                };

                await interaction.editReply({
                    embeds: [confirmEmbed],
                    components: [selectRow, buttonRow]
                });

            } catch (error) {
                console.error('Modal処理エラー:', error);
                await interaction.editReply('❌ フォームの処理中にエラーが発生しました。');
            }
        }
    }

    // セレクトメニューの処理
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'scenario_select') {
            const selectedScenario = interaction.values[0];
            const scenarioLabel = TRPG_SCENARIOS.find(s => s.value === selectedScenario)?.label || 'その他';
            
            // グローバルデータに追加
            if (global.tempNotionData && global.tempNotionData.userId === interaction.user.id) {
                global.tempNotionData.scenario = {
                    value: selectedScenario,
                    label: scenarioLabel
                };
            }

            await interaction.reply({ 
                content: `✅ TRPGシナリオ「${scenarioLabel}」を選択しました。`,
                ephemeral: true 
            });
        }
    }

    // ボタンクリック時の処理
    if (interaction.isButton()) {
        if (interaction.customId === 'confirm_notion_add') {
            try {
                await interaction.deferReply({ ephemeral: true });

                const tempData = global.tempNotionData;
                if (!tempData || tempData.userId !== interaction.user.id) {
                    await interaction.editReply('❌ セッションデータが見つかりません。最初からやり直してください。');
                    return;
                }

                if (!tempData.scenario) {
                    await interaction.editReply('❌ TRPGシナリオを選択してください。');
                    return;
                }

                // Discord情報を取得
                const channel = interaction.channel;
                const channelInfo = {
                    channelId: channel.id,
                    channelName: channel.name || 'DM',
                    threadId: channel.isThread() ? channel.id : null,
                    threadName: channel.isThread() ? channel.name : null,
                    parentChannelId: channel.isThread() ? channel.parentId : channel.id,
                    parentChannelName: channel.isThread() ? channel.parent?.name : channel.name
                };

                // Notionにページを作成
                const notionProperties = {
                    '卓名': {
                        title: [
                            {
                                text: {
                                    content: tempData.tableName
                                }
                            }
                        ]
                    },
                    '日付': {
                        date: {
                            start: tempData.sessionDate
                        }
                    },
                    'GM': {
                        multi_select: tempData.gmNames.map(name => ({ name }))
                    },
                    'PL': {
                        multi_select: tempData.plNames.map(name => ({ name }))
                    }
                };

                // Discord情報をプロパティに追加（フィールドが存在する場合のみ）
                if (channelInfo.channelId) {
                    notionProperties['Discord Channel ID'] = {
                        rich_text: [
                            {
                                text: {
                                    content: channelInfo.parentChannelId
                                }
                            }
                        ]
                    };
                }

                if (channelInfo.threadId) {
                    notionProperties['Thread ID'] = {
                        rich_text: [
                            {
                                text: {
                                    content: channelInfo.threadId
                                }
                            }
                        ]
                    };
                }

                if (channelInfo.parentChannelName) {
                    notionProperties['Channel名'] = {
                        rich_text: [
                            {
                                text: {
                                    content: channelInfo.parentChannelName
                                }
                            }
                        ]
                    };
                }

                if (channelInfo.threadName) {
                    notionProperties['Thread名'] = {
                        rich_text: [
                            {
                                text: {
                                    content: channelInfo.threadName
                                }
                            }
                        ]
                    };
                }

                const response = await notion.pages.create({
                    parent: {
                        database_id: process.env.NOTION_DATABASE_ID
                    },
                    properties: notionProperties
                });

                // 成功Embed（Discord情報も表示）
                const successEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ Notionに追加完了！')
                    .setDescription('TRPG卓情報がNotionデータベースに正常に追加されました。')
                    .addFields(
                        { name: '🏷️ 卓名', value: tempData.tableName, inline: true },
                        { name: '📅 開催日', value: tempData.sessionDate, inline: true },
                        { name: '🎮 シナリオ', value: tempData.scenario.label, inline: true },
                        { name: '🎮 GM', value: tempData.gmNames.join(', '), inline: true },
                        { name: '👥 PL', value: tempData.plNames.join(', ') || '未設定', inline: true },
                        { name: '📍 チャンネル', value: channelInfo.parentChannelName, inline: true }
                    );

                // スレッド情報があれば追加
                if (channelInfo.threadName) {
                    successEmbed.addFields(
                        { name: '🧵 スレッド', value: channelInfo.threadName, inline: true }
                    );
                }

                successEmbed.setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

                // 一時データをクリア
                delete global.tempNotionData;

                console.log('✅ Notionページ作成成功:', response.id);

            } catch (error) {
                console.error('❌ Notion追加エラー:', error);
                await interaction.editReply('❌ Notionへの追加中にエラーが発生しました。');
            }
        }

        if (interaction.customId === 'cancel_notion_add') {
            delete global.tempNotionData;
            await interaction.reply({ 
                content: '❌ キャンセルしました。', 
                ephemeral: true 
            });
        }
    }
});

// エラーハンドリング
client.on('error', error => {
    console.error('❌ Discordクライアントエラー:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ 予期しないエラー:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ 処理されていないPromise拒否:', error);
});

// Render用のWebサーバー
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'Bot is running!',
        botName: client.user?.tag || 'Bot',
        servers: client.guilds.cache.size,
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} is already in use. Trying port ${PORT + 1}...`);
        app.listen(PORT + 1);
    } else {
        console.error('❌ Server error:', err);
    }
});

// ボットにログイン
console.log('🚀 ボットを起動中...');
client.login(process.env.BOT_TOKEN);