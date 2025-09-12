// 必要なライブラリを読み込み
const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { Client: NotionClient } = require('@notionhq/client');
const express = require('express');
const cron = require('node-cron');
const ogs = require('open-graph-scraper');
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
    },
    {
        name: 'sync-forum',
        description: '手動でフォーラムの最新スレッドをNotionに同期します'
    }
];

// メンバー選択肢
const MEMBERS = [
    { label: 'やす', value: 'yasu', emoji: '🎮' },
    { label: 'うお', value: 'uo', emoji: '🐟' },
    { label: 'カン', value: 'kan', emoji: '🔥' },
    { label: 'ザク', value: 'zaku', emoji: '🤖' }
];

// ステータス更新関数
async function updateScenarioStatus(pageId) {
    try {
        console.log(`🔄 ページ ${pageId} のステータスを「やる予定」に更新中...`);
        const updateResponse = await notion.pages.update({
            page_id: pageId,
            properties: {
                'ステータス': {
                    status: {
                        name: 'やる予定'
                    }
                }
            }
        });
        console.log(`✅ ステータス更新成功: ${pageId}`);
        return { success: true, message: 'ステータスを「やる予定」に更新しました' };
    } catch (error) {
        console.error('❌ ステータス更新エラー:', error);
        return { success: false, message: `ステータス更新エラー: ${error.message}` };
    }
}

// NotionデータベースからURLを基にページを検索する関数
async function getNotionPagesByUrl(databaseId, url) {
    try {
        const response = await notion.databases.query({
            database_id: databaseId,
            filter: {
                property: "スレッドURL",
                rich_text: {
                    contains: url
                }
            }
        });
        return response.results;
    } catch (error) {
        console.error('❌ Notionページ検索エラー:', error);
        return [];
    }
}

// Discordのスレッドにメッセージを送信する関数
async function addDiscordThreadMessage(threadId, message) {
    try {
        const thread = await client.channels.fetch(threadId);
        if (thread && thread.isThread()) {
            await thread.send(message);
            console.log(`✅ スレッド ${threadId} にメッセージを送信しました。`);
            return true;
        }
    } catch (error) {
        console.error(`❌ スレッド ${threadId} へのメッセージ送信エラー:`, error);
        return false;
    }
}

// フォーラム同期のコアロジックを関数化
async function syncForumToNotion(channelId) {
    const forumChannel = await client.channels.fetch(channelId);
    
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        console.error('❌ フォーラム同期エラー: 指定されたIDは有効なフォーラムチャンネルではありません。');
        return { added: 0, skipped: 0, failed: 0 };
    }
    
    console.log(`🔄 フォーラム ${forumChannel.name} のスレッドを取得中...`);
    
    const threads = await forumChannel.threads.fetch({ limit: 15, archived: false });
    const newThreads = threads.threads.toJSON();
    
    if (newThreads.length === 0) {
        console.log('⚠️ 最新のスレッドが見つかりませんでした。');
        return { added: 0, skipped: 0, failed: 0 };
    }
    
    console.log(`✅ ${newThreads.length}件のスレッドを取得しました。`);
    
    let addedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const notionDatabaseId = process.env.NOTION_THREAD_DATABASE_ID;

    for (const thread of newThreads) {
        try {
            const threadUrl = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
            
            const existingPages = await getNotionPagesByUrl(notionDatabaseId, threadUrl);
            if (existingPages.length > 0) {
                console.log(`⚠️ スレッド "${thread.name}" はNotionにすでに存在します。スキップします。`);
                skippedCount++;
                continue;
            }
            
            const starterMessage = await thread.fetchStarterMessage();
            const messageContent = starterMessage ? starterMessage.content : '';

            if (messageContent) {
                console.log(`💬 メッセージ内容の読み取り:\n${messageContent}`);
            } else {
                console.log(`💬 メッセージ内容: 空欄または見つかりません`);
            }
            
            const attachments = starterMessage ? starterMessage.attachments.toJSON() : [];

            let imageUrl = attachments.find(att => att.contentType.startsWith('image/'))?.url || null;
            const fileUrl = attachments.find(att => !att.contentType.startsWith('image/'))?.url || null;
            
            const boothOrPixivUrlRegex = /(https?:\/\/(?:www\.pixiv\.net|booth\.pm)\S+)/;
            const extractedUrl = messageContent.match(boothOrPixivUrlRegex)?.[0] || null;

            // ✅ OGP画像の取得ロジックを修正
            // まずはOGP画像の取得を試みる
            if (extractedUrl) {
                try {
                    console.log(`🔎 OGP取得を試行: ${extractedUrl}`);
                    const { result: ogsResult } = await ogs({ url: extractedUrl });
                    if (ogsResult.success && ogsResult.ogImage && ogsResult.ogImage.url) {
                        imageUrl = ogsResult.ogImage.url;
                        console.log(`🖼️ OGP画像を取得しました: ${imageUrl}`);
                    }
                } catch (ogsError) {
                    console.warn(`⚠️ OGP取得エラー (${extractedUrl}): ${ogsError.message}`);
                }
            }

            // OGP画像が取得できなかった場合、添付画像を代替として使う
            if (!imageUrl && attachments.length > 0) {
                imageUrl = attachments.find(att => att.contentType.startsWith('image/'))?.url || null;
            }

            const notionProperties = {
                "ステータス": { status: { name: "未着手" } },
                "名前": { title: [{ text: { content: thread.name } }] },
                "作成日時": { date: { start: thread.createdAt.toISOString() } },
                "スレッドURL": { url: threadUrl }
            };

            if (extractedUrl) {
                notionProperties["URL"] = { url: extractedUrl };
            }

            const pageChildren = [];

            if (imageUrl) {
                notionProperties["ファイル&メディア"] = { files: [{ external: { url: imageUrl }, name: 'thumbnail' }] };
                pageChildren.push({ object: "block", type: "image", image: { type: "external", external: { url: imageUrl } } });
            } else if (fileUrl) {
                notionProperties["ファイル&メディア"] = { files: [{ external: { url: fileUrl }, name: 'file' }] };
                pageChildren.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "ファイル&メディア: " } }, { type: "text", text: { content: fileUrl, link: { url: fileUrl } } }] } });
            }
            pageChildren.unshift(
                { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "基本情報" } }] } },
                { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: `スレッドURL: ` } }, { type: "text", text: { content: threadUrl, link: { url: threadUrl } } }] } }
            );
            if (messageContent) {
                pageChildren.push({ object: "block", type: "quote", quote: { rich_text: [{ type: "text", text: { content: messageContent } }] } });
            }
            
            const createResponse = await notion.pages.create({ parent: { database_id: notionDatabaseId }, properties: notionProperties, children: pageChildren });
            addedCount++;
            const notionPageUrl = `https://www.notion.so/${createResponse.id.replace(/-/g, '')}`;
            const discordMessage = `✅ このスレッドの情報をNotionに同期しました！\n🔗 Notionページ: ${notionPageUrl}`;
            await addDiscordThreadMessage(thread.id, discordMessage);
        } catch (notionError) {
            console.error(`❌ スレッド "${thread.name}" のNotion追加エラー:`, notionError);
            failedCount++;
        }
    }
    return { added: addedCount, skipped: skippedCount, failed: failedCount };
}

// Render用のWebサーバー（早期初期化）
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    const botStatus = client.isReady() ? 'Online' : 'Connecting...';
    res.json({ status: 'Bot is running!', botStatus: botStatus, botName: client.user?.tag || 'Bot', servers: client.guilds.cache.size, uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString(), ping: client.ws.ping || -1 });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), botReady: client.isReady() });
});

// GASからのトリガー用エンドポイント
app.get('/trigger-sync', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.WEBHOOK_SECRET) {
        console.warn('⚠️ 不正なトリガーリクエストを受信しました。');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const channelId = '1415707028911034489';
    try {
        const result = await syncForumToNotion(channelId);
        res.status(200).json({ status: 'Sync successful', ...result });
    } catch (error) {
        console.error('❌ GASからトリガーされたタスクの実行中にエラーが発生しました:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

function keepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(async () => {
        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(`${url}/health`);
            const data = await response.json();
            console.log(`🏓 Keep-alive ping: ${data.status} at ${data.timestamp}`);
        } catch (error) {
            console.log('⚠️ Keep-alive ping failed:', error.message);
        }
    }, 25 * 60 * 1000);
}

const server = app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    if (process.env.NODE_ENV === 'production' || process.env.RENDER_EXTERNAL_URL) {
        console.log('🔄 Keep-alive機能を開始します...');
        keepAlive();
    }
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} is already in use. Trying port ${PORT + 1}...`);
        app.listen(PORT + 1);
    } else {
        console.error('❌ Server error:', err);
    }
});

// ボット起動時の処理
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がオンラインになりました！`);
    console.log(`🔗 ${client.guilds.cache.size}個のサーバーに接続中`);

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    
    try {
        console.log('🗑️ 全てのコマンドを強制削除中...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        
        for (const guild of client.guilds.cache.values()) {
            try {
                await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [] });
                console.log(`🗑️ ${guild.name} のコマンドを削除`);
            } catch (guildError) {
                console.log(`⚠️ ${guild.name} のコマンド削除をスキップ`);
            }
        }
        
        console.log('✅ 全コマンド削除完了！');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('🔄 新しいコマンドを登録中...');
        const result = await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        
        console.log(`✅ ${result.length}個のコマンド登録完了！`);
        console.log('📝 登録されたコマンド:', result.map(cmd => cmd.name).join(', '));
        
    } catch (error) {
        console.error('❌ コマンド処理エラー:', error);
    }

    // cronによる定期実行タスク
    cron.schedule('0 1 * * *', async () => {
        console.log('⏰ スケジュールされたタスクを実行中: フォーラム同期...');
        const channelId = '1415707028911034489';
        try {
            const result = await syncForumToNotion(channelId);
            console.log(`📝 定期タスク完了: 追加数 ${result.added}, スキップ数 ${result.skipped}, 失敗数 ${result.failed}`);
        } catch (error) {
            console.error('❌ スケジュールされたタスクの実行中にエラーが発生しました:', error);
        }
    }, {
        timezone: "Asia/Tokyo"
    });
});

client.on('reconnecting', () => { console.log('🔄 Discordに再接続中...'); });
client.on('resumed', () => { console.log('✅ Discord接続が復旧しました'); });

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        console.log(`🎯 受信したコマンド: "${commandName}"`);
        console.log(`🔍 コマンドタイプ: ${typeof commandName}`);
        console.log(`🔍 コマンド長: ${commandName.length}`);
        
        try {
            console.log(`📝 コマンド実行: ${commandName}`);
            
            if (commandName === 'ping') {
                console.log('✅ pingコマンド実行');
                const ping = client.ws.ping;
                const uptime = Math.floor(process.uptime());
                await interaction.reply(`🏓 Pong! レイテンシ: ${ping}ms\n⏱️ 稼働時間: ${uptime}秒`);
            } else if (commandName === 'hello') {
                console.log('✅ helloコマンド実行');
                const user = interaction.options.getUser('user');
                const message = user ? `👋 こんにちは、${user}さん！` : `👋 こんにちは、${interaction.user}さん！`;
                await interaction.reply(message);
            } else if (commandName === 'serverinfo') {
                console.log('✅ serverinfoコマンド実行');
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
            } else if (commandName === 'add-notion') {
                console.log('✅ add-notionコマンド実行');
                try {
                    const modal = new ModalBuilder().setCustomId('notion_trpg_modal').setTitle('🎲 TRPG卓情報をNotionに追加');
                    const tableNameInput = new TextInputBuilder().setCustomId('table_name').setLabel('卓名').setStyle(TextInputStyle.Short).setPlaceholder('例: 第1回クトゥルフ卓').setRequired(true).setMaxLength(100);
                    const dateInput = new TextInputBuilder().setCustomId('session_date').setLabel('開催日（省略可能）').setStyle(TextInputStyle.Short).setPlaceholder('例: 2025-06-25, 06/25, 明日, 来週土曜日（空欄でもOK）').setRequired(false).setMaxLength(20);
                    const firstActionRow = new ActionRowBuilder().addComponents(tableNameInput);
                    const secondActionRow = new ActionRowBuilder().addComponents(dateInput);
                    modal.addComponents(firstActionRow, secondActionRow);
                    console.log('🎲 モーダルを表示します...');
                    await interaction.showModal(modal);
                    console.log('✅ モーダル表示完了');
                } catch (modalError) {
                    console.error('❌ Modal表示エラー:', modalError);
                    await interaction.reply({ content: '❌ フォーム表示エラー: ' + modalError.message, flags: 64 });
                }
            } else if (commandName === 'sync-forum') {
                await interaction.deferReply({ ephemeral: true });
                const channelId = '1415707028911034489';
                try {
                    const result = await syncForumToNotion(channelId);
                    const embed = new EmbedBuilder()
                        .setColor(result.added > 0 ? 0x00ff00 : 0xffff00)
                        .setTitle('📝 フォーラム同期完了')
                        .setDescription(`手動同期が完了しました。`)
                        .addFields(
                            { name: '✅ 新規追加', value: result.added.toString(), inline: true },
                            { name: '⏩ スキップ', value: result.skipped.toString(), inline: true },
                            { name: '❌ 失敗', value: result.failed.toString(), inline: true }
                        )
                        .setTimestamp();
                    await interaction.editReply({ embeds: [embed] });
                } catch (fetchError) {
                    console.error('❌ スレッド取得エラー:', fetchError);
                    await interaction.editReply('❌ スレッドの取得中にエラーが発生しました。ボットにチャンネルの閲覧権限があるか確認してください。');
                }
            } else {
                console.log(`❌ 未知のコマンド: "${commandName}"`);
                console.log('🔍 利用可能なコマンド: ping, hello, serverinfo, add-notion, sync-forum');
                await interaction.reply('❌ 未知のコマンドです。');
            }
        } catch (error) {
            console.error('コマンド実行エラー:', error);
            if (interaction.replied) {
                try {
                    await interaction.editReply('❌ コマンドの実行中にエラーが発生しました。');
                } catch {
                    await interaction.followUp({ content: '❌ コマンドの実行中にエラーが発生しました。', ephemeral: true });
                }
            } else {
                await interaction.reply('❌ コマンドの実行中にエラーが発生しました。');
            }
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'notion_trpg_modal') {
            try {
                await interaction.deferReply();
                const tableName = interaction.fields.getTextInputValue('table_name');
                const sessionDate = interaction.fields.getTextInputValue('session_date');
                function parseDate(dateInput) {
                    if (!dateInput || dateInput.trim() === '') { return null; }
                    const today = new Date();
                    const inputLower = dateInput.toLowerCase().trim();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) { return dateInput; }
                    if (/^\d{1,2}\/\d{1,2}$/.test(dateInput)) {
                        const [month, day] = dateInput.split('/');
                        const year = today.getFullYear();
                        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    }
                    if (inputLower === '今日' || inputLower === 'today') { return today.toISOString().split('T')[0]; }
                    if (inputLower === '明日' || inputLower === 'tomorrow') {
                        const tomorrow = new Date(today);
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        return tomorrow.toISOString().split('T')[0];
                    }
                    if (inputLower.includes('来週')) {
                        const nextWeek = new Date(today);
                        nextWeek.setDate(nextWeek.getDate() + 7);
                        return nextWeek.toISOString().split('T')[0];
                    }
                    return dateInput;
                }
                const parsedDate = parseDate(sessionDate);
                if (parsedDate && !/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
                    await interaction.editReply(`❌ 日付の形式を認識できませんでした。`);
                    return;
                }
                const gmSelect = new StringSelectMenuBuilder().setCustomId('gm_select').setPlaceholder('🎮 GMを選択してください（複数選択可）').setMinValues(1).setMaxValues(4).addOptions(MEMBERS.map(member => ({ label: member.label, value: member.value, emoji: member.emoji })));
                const plSelect = new StringSelectMenuBuilder().setCustomId('pl_select').setPlaceholder('👥 PLを選択してください（複数選択可・任意）').setMinValues(0).setMaxValues(4).addOptions(MEMBERS.map(member => ({ label: member.label, value: member.value, emoji: member.emoji })));
                const gmSelectRow = new ActionRowBuilder().addComponents(gmSelect);
                const plSelectRow = new ActionRowBuilder().addComponents(plSelect);
                const confirmButton = new ButtonBuilder().setCustomId('confirm_notion_add').setLabel('✅ Notionに追加').setStyle(ButtonStyle.Primary);
                const cancelButton = new ButtonBuilder().setCustomId('cancel_notion_add').setLabel('❌ キャンセル').setStyle(ButtonStyle.Secondary);
                const buttonRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
                const confirmEmbed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle('🎲 TRPG卓情報確認')
                    .addFields(
                        { name: '🏷️ 卓名', value: tableName, inline: true },
                        { name: '📅 開催日', value: parsedDate ? `${parsedDate}${sessionDate !== parsedDate ? ` (${sessionDate})` : ''}` : '未設定', inline: true }
                    )
                    .setFooter({ text: 'GMとPLを選択メニューで選んで「Notionに追加」をクリックしてください' });
                global.tempNotionData = { userId: interaction.user.id, tableName, sessionDate: parsedDate, originalDate: sessionDate, selectedGm: [], selectedPl: [] };
                await interaction.editReply({ embeds: [confirmEmbed], components: [gmSelectRow, plSelectRow, buttonRow] });
            } catch (error) {
                console.error('Modal処理エラー:', error);
                await interaction.editReply('❌ フォームの処理中にエラーが発生しました。');
            }
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'gm_select') {
            const selectedGm = interaction.values;
            if (global.tempNotionData && global.tempNotionData.userId === interaction.user.id) { global.tempNotionData.selectedGm = selectedGm; }
            await interaction.deferUpdate();
        }
        if (interaction.customId === 'pl_select') {
            const selectedPl = interaction.values;
            if (global.tempNotionData && global.tempNotionData.userId === interaction.user.id) { global.tempNotionData.selectedPl = selectedPl; }
            await interaction.deferUpdate();
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'confirm_notion_add') {
            try {
                await interaction.deferReply();
                const tempData = global.tempNotionData;
                if (!tempData || tempData.userId !== interaction.user.id) {
                    await interaction.editReply('❌ セッションデータが見つかりません。最初からやり直してください。');
                    return;
                }
                if (!tempData.selectedGm || tempData.selectedGm.length === 0) {
                    await interaction.editReply('❌ GMを選択してください。');
                    return;
                }
                const selectedGmNames = tempData.selectedGm.map(value => MEMBERS.find(m => m.value === value)?.label).filter(Boolean);
                const selectedPlNames = tempData.selectedPl.map(value => MEMBERS.find(m => m.value === value)?.label).filter(Boolean);
                const channel = interaction.channel;
                const channelInfo = { channelId: channel.id, channelName: channel.name || 'DM', threadId: channel.isThread() ? channel.id : null, threadName: channel.isThread() ? channel.name : null, parentChannelId: channel.isThread() ? channel.parentId : channel.id, parentChannelName: channel.isThread() ? channel.parent?.name : channel.name, threadUrl: channel.isThread() ? `https://discord.com/channels/${channel.guildId}/${channel.id}` : null };
                console.log('📍 Discord情報:', channelInfo);
                let relatedThreadPage = null;
                let imageUrl = null;
                let statusUpdateResult = null;
                if (channelInfo.threadUrl && process.env.NOTION_THREAD_DATABASE_ID) {
                    try {
                        console.log('🔍 スレッドURLで別DBを検索中...', channelInfo.threadUrl);
                        const threadSearchResponse = await notion.databases.query({ database_id: process.env.NOTION_THREAD_DATABASE_ID, filter: { property: "スレッドURL", rich_text: { contains: channelInfo.threadUrl } } });
                        console.log(`🔍 検索結果: ${threadSearchResponse.results.length}件`);
                        if (threadSearchResponse.results.length > 0) {
                            relatedThreadPage = threadSearchResponse.results[0];
                            console.log('✅ 関連スレッドページ発見:', relatedThreadPage.id);
                            console.log('🔄 シナリオページのステータス更新を開始...');
                            statusUpdateResult = await updateScenarioStatus(relatedThreadPage.id);
                            if (statusUpdateResult.success) { console.log('✅ ステータス更新成功:', statusUpdateResult.message); } else { console.log('⚠️ ステータス更新失敗:', statusUpdateResult.message); }
                            try {
                                const pageDetails = await notion.pages.retrieve({ page_id: relatedThreadPage.id });
                                console.log('📄 ページ詳細を取得:', pageDetails.id);
                                const possibleFileProperties = ['ファイル&メディア', 'ファイル', 'メディア', 'Files & media', 'Files', 'Media', 'Image', '画像'];
                                for (const propName of possibleFileProperties) {
                                    const fileProperty = pageDetails.properties[propName];
                                    if (fileProperty && fileProperty.type === 'files' && fileProperty.files && fileProperty.files.length > 0) {
                                        const firstFile = fileProperty.files[0];
                                        if (firstFile.type === 'external' && firstFile.external && firstFile.external.url) {
                                            const url = firstFile.external.url;
                                            if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i)) { imageUrl = url; console.log(`🖼️ 外部画像URL取得 (${propName}):`, imageUrl); break; } else { console.log(`⚠️ 画像以外のURL: ${url}`); }
                                        } else if (firstFile.type === 'file' && firstFile.file && firstFile.file.url) {
                                            imageUrl = firstFile.file.url; console.log(`🖼️ Notion画像URL取得 (${propName}):`, imageUrl); break;
                                        }
                                    }
                                }
                                if (!imageUrl) { console.log('⚠️ ファイル&メディアプロパティまたは画像が見つかりませんでした'); console.log('🔍 利用可能なプロパティ:', Object.keys(pageDetails.properties)); }
                            } catch (pageError) { console.error('❌ ページ詳細取得エラー:', pageError); }
                        } else { console.log('⚠️ 関連スレッドページが見つかりませんでした'); }
                    } catch (searchError) { console.error('❌ スレッド検索エラー:', searchError); }
                }

                const notionProperties = {
                    '卓名': { title: [{ text: { content: tempData.tableName } }] },
                    'GM': { multi_select: selectedGmNames.map(name => ({ name })) },
                    'PL': { multi_select: selectedPlNames.map(name => ({ name })) }
                };
                if (tempData.sessionDate) { notionProperties['日付'] = { date: { start: tempData.sessionDate } }; }
                if (relatedThreadPage) { notionProperties['TRPGシナリオ'] = { relation: [{ id: relatedThreadPage.id }] }; console.log('🔗 リレーション設定:', relatedThreadPage.id); statusUpdateResult = await updateScenarioStatus(relatedThreadPage.id); }

                console.log('📝 送信するNotionプロパティ:', JSON.stringify(notionProperties, null, 2));
                const pageChildren = [];
                if (imageUrl) { pageChildren.push({ object: 'block', type: 'image', image: { type: 'external', external: { url: imageUrl } } }); console.log('🖼️ ページ本文に画像を追加:', imageUrl); }
                const response = await notion.pages.create({ parent: { database_id: process.env.NOTION_DATABASE_ID }, properties: notionProperties, children: pageChildren });

                const notionPageUrl = `https://www.notion.so/${response.id.replace(/-/g, '')}`;
                const successEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ Notionに追加完了！')
                    .setDescription(`TRPG卓情報がNotionデータベースに正常に追加されました。\n\n🔗 [Notionページを開く](${notionPageUrl})`)
                    .addFields(
                        { name: '🏷️ 卓名', value: tempData.tableName, inline: true },
                        { name: '📅 開催日', value: tempData.sessionDate || '未設定', inline: true },
                        { name: '🎮 GM', value: selectedGmNames.join(', '), inline: true },
                        { name: '👥 PL', value: selectedPlNames.join(', ') || 'なし', inline: true },
                        { name: '📍 チャンネル', value: channelInfo.parentChannelName, inline: true }
                    );
                if (imageUrl) { successEmbed.addFields({ name: '🖼️ 画像', value: 'シナリオ画像をページ本文に追加しました', inline: true }); console.log('🖼️ 本文に画像追加完了'); }
                if (channelInfo.threadName) { successEmbed.addFields({ name: '🧵 スレッド', value: channelInfo.threadName, inline: true }); }
                if (relatedThreadPage) {
                    const relationTitle = relatedThreadPage.properties?.Name?.title?.[0]?.text?.content || relatedThreadPage.properties?.タイトル?.title?.[0]?.text?.content || 'シナリオページ';
                    successEmbed.addFields({ name: '🔗 リレーション', value: `${relationTitle} にリンク済み`, inline: true });
                } else if (channelInfo.threadUrl) {
                    successEmbed.addFields({ name: '⚠️ リレーション', value: '対応するシナリオページが見つかりませんでした', inline: true });
                }
                if (statusUpdateResult) {
                    if (statusUpdateResult.success) { successEmbed.addFields({ name: '🎯 ステータス更新', value: '✅ シナリオを「やる予定」に更新しました', inline: true }); } else { successEmbed.addFields({ name: '⚠️ ステータス更新', value: `❌ ${statusUpdateResult.message}`, inline: true }); }
                }
                successEmbed.setTimestamp();
                await interaction.editReply({ embeds: [successEmbed] });
                delete global.tempNotionData;
                console.log('✅ Notionページ作成成功:', response.id);
            } catch (error) {
                console.error('❌ Notion追加エラー（詳細）:', error);
                console.error('❌ エラーメッセージ:', error.message);
                console.error('❌ エラーコード:', error.code);
                console.error('❌ エラースタック:', error.stack);
                let errorMessage = 'Notionへの追加中にエラーが発生しました。';
                if (!process.env.NOTION_TOKEN) { errorMessage += '\n❌ NOTION_TOKENが設定されていません。'; }
                if (!process.env.NOTION_DATABASE_ID) { errorMessage += '\n❌ NOTION_DATABASE_IDが設定されていません。'; }
                if (error.code === 'unauthorized') { errorMessage += '\n❌ Notion Integration Tokenが無効です。'; } else if (error.code === 'object_not_found') { errorMessage += '\n❌ Notionデータベースが見つかりません。'; } else if (error.code === 'validation_error') { errorMessage += '\n❌ Notionプロパティの設定に問題があります。'; }
                await interaction.editReply(errorMessage);
            }
        }
        if (interaction.customId === 'cancel_notion_add') {
            delete global.tempNotionData;
            await interaction.reply({ content: '❌ キャンセルしました。', flags: 64 });
        }
    }
});

client.on('error', error => { console.error('❌ Discordクライアントエラー:', error); });
client.on('warn', warning => { console.warn('⚠️ Discord警告:', warning); });
client.on('shardError', error => { console.error('❌ Discord Shardエラー:', error); });
process.on('uncaughtException', error => { console.error('❌ 予期しないエラー:', error); console.log('🔄 プロセスを継続します...'); });
process.on('unhandledRejection', error => { console.error('❌ 処理されていないPromise拒否:', error); });
process.on('SIGTERM', () => { console.log('📴 SIGTERM受信。グレースフルシャットダウンを開始...'); server.close(() => { console.log('🌐 HTTPサーバーを停止しました'); client.destroy(); console.log('🤖 Discordクライアントを停止しました'); process.exit(0); }); });
process.on('SIGINT', () => { console.log('📴 SIGINT受信。グレースフルシャットダウンを開始...'); server.close(() => { console.log('🌐 HTTPサーバーを停止しました'); client.destroy(); console.log('🤖 Discordクライアントを停止しました'); process.exit(0); }); });
console.log('🚀 ボットを起動中...');
client.login(process.env.BOT_TOKEN).catch(error => { console.error('❌ ボットログインエラー:', error); process.exit(1); });