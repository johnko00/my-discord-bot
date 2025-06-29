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

// メンバー選択肢
const MEMBERS = [
    { label: 'やす', value: 'yasu', emoji: '🎮' },
    { label: 'うお', value: 'uo', emoji: '🐟' },
    { label: 'カン', value: 'kan', emoji: '🔥' },
    { label: 'ザク', value: 'zaku', emoji: '🤖' }
];

// Render用のWebサーバー（早期初期化）
const app = express();
const PORT = process.env.PORT || 3000;

// ヘルスチェック用ルート
app.get('/', (req, res) => {
    const botStatus = client.isReady() ? 'Online' : 'Connecting...';
    res.json({
        status: 'Bot is running!',
        botStatus: botStatus,
        botName: client.user?.tag || 'Bot',
        servers: client.guilds.cache.size,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        ping: client.ws.ping || -1
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        botReady: client.isReady()
    });
});

// Keep-alive機能：自分自身にpingを送る
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
    }, 25 * 60 * 1000); // 25分間隔（30分制限より少し短く）
}

// サーバー起動
const server = app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    
    // Keep-alive機能を開始（production環境のみ）
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
        
        // グローバルコマンドを削除
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [] }
        );
        
        // 各ギルドのコマンドも削除
        for (const guild of client.guilds.cache.values()) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guild.id),
                    { body: [] }
                );
                console.log(`🗑️ ${guild.name} のコマンドを削除`);
            } catch (guildError) {
                console.log(`⚠️ ${guild.name} のコマンド削除をスキップ`);
            }
        }
        
        console.log('✅ 全コマンド削除完了！');
        
        // 少し待ってから新しいコマンドを登録
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('🔄 新しいコマンドを登録中...');
        const result = await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        
        console.log(`✅ ${result.length}個のコマンド登録完了！`);
        console.log('📝 登録されたコマンド:', result.map(cmd => cmd.name).join(', '));
        
    } catch (error) {
        console.error('❌ コマンド処理エラー:', error);
    }
});

// 再接続時の処理
client.on('reconnecting', () => {
    console.log('🔄 Discordに再接続中...');
});

client.on('resumed', () => {
    console.log('✅ Discord接続が復旧しました');
});

// スラッシュコマンドが実行された時の処理
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
                const message = user
                    ? `👋 こんにちは、${user}さん！`
                    : `👋 こんにちは、${interaction.user}さん！`;
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

                    // 日付入力（必須を外し、プレースホルダーを更新）
                    const dateInput = new TextInputBuilder()
                        .setCustomId('session_date')
                        .setLabel('開催日（省略可能）')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('例: 2025-06-25, 06/25, 明日, 来週土曜日（空欄でもOK）')
                        .setRequired(false)  // 必須を false に変更
                        .setMaxLength(20);

                    // ActionRowを作成（GM/PL項目を削除）
                    const firstActionRow = new ActionRowBuilder().addComponents(tableNameInput);
                    const secondActionRow = new ActionRowBuilder().addComponents(dateInput);

                    modal.addComponents(firstActionRow, secondActionRow);

                    console.log('🎲 モーダルを表示します...');
                    await interaction.showModal(modal);
                    console.log('✅ モーダル表示完了');

                } catch (modalError) {
                    console.error('❌ Modal表示エラー:', modalError);
                    await interaction.reply({
                        content: '❌ フォーム表示エラー: ' + modalError.message,
                        flags: 64 // ephemeral flag
                    });
                }
            } else {
                console.log(`❌ 未知のコマンド: "${commandName}"`);
                console.log('🔍 利用可能なコマンド: ping, hello, serverinfo, add-notion');
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
                await interaction.deferReply(); // 全体に公開

                const tableName = interaction.fields.getTextInputValue('table_name');
                const sessionDate = interaction.fields.getTextInputValue('session_date');

                // 日付を標準形式に変換する関数
                function parseDate(dateInput) {
                    // 空欄または空文字列の場合は null を返す
                    if (!dateInput || dateInput.trim() === '') {
                        return null;
                    }
                    
                    const today = new Date();
                    const inputLower = dateInput.toLowerCase().trim();
                    
                    // YYYY-MM-DD形式の場合
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
                        return dateInput;
                    }
                    
                    // MM/DD形式の場合
                    if (/^\d{1,2}\/\d{1,2}$/.test(dateInput)) {
                        const [month, day] = dateInput.split('/');
                        const year = today.getFullYear();
                        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    }
                    
                    // 相対日付の処理
                    if (inputLower === '今日' || inputLower === 'today') {
                        return today.toISOString().split('T')[0];
                    }
                    
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
                    
                    // その他の場合はそのまま返す
                    return dateInput;
                }

                const parsedDate = parseDate(sessionDate);

                // 日付が入力されている場合のみ形式をチェック
                if (parsedDate && !/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
                    await interaction.editReply(`❌ 日付の形式を認識できませんでした。以下の形式で入力してください：
• YYYY-MM-DD (例: 2025-06-25)
• MM/DD (例: 06/25)
• 今日、明日、来週
• 空欄（日付なし）`);
                    return;
                }

                // GM選択メニューを表示
                const gmSelect = new StringSelectMenuBuilder()
                    .setCustomId('gm_select')
                    .setPlaceholder('🎮 GMを選択してください（複数選択可）')
                    .setMinValues(1)
                    .setMaxValues(4)
                    .addOptions(
                        MEMBERS.map(member => ({
                            label: member.label,
                            value: member.value,
                            emoji: member.emoji
                        }))
                    );

                // PL選択メニューを表示
                const plSelect = new StringSelectMenuBuilder()
                    .setCustomId('pl_select')
                    .setPlaceholder('👥 PLを選択してください（複数選択可・任意）')
                    .setMinValues(0)
                    .setMaxValues(4)
                    .addOptions(
                        MEMBERS.map(member => ({
                            label: member.label,
                            value: member.value,
                            emoji: member.emoji
                        }))
                    );

                const gmSelectRow = new ActionRowBuilder().addComponents(gmSelect);
                const plSelectRow = new ActionRowBuilder().addComponents(plSelect);

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

                // 確認用Embed（日付が null の場合の表示を調整）
                const confirmEmbed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle('🎲 TRPG卓情報確認')
                    .addFields(
                        { name: '🏷️ 卓名', value: tableName, inline: true },
                        { 
                            name: '📅 開催日', 
                            value: parsedDate 
                                ? `${parsedDate}${sessionDate !== parsedDate ? ` (${sessionDate})` : ''}` 
                                : '未設定', 
                            inline: true 
                        }
                    )
                    .setFooter({ text: 'GMとPLを選択メニューで選んで「Notionに追加」をクリックしてください' });

                // 一時的にデータを保存（パース済み日付を使用）
                global.tempNotionData = {
                    userId: interaction.user.id,
                    tableName,
                    sessionDate: parsedDate,  // null の可能性あり
                    originalDate: sessionDate, // 元の入力も保存
                    selectedGm: [], // 選択されたGM（後で設定）
                    selectedPl: []  // 選択されたPL（後で設定）
                };

                await interaction.editReply({
                    embeds: [confirmEmbed],
                    components: [gmSelectRow, plSelectRow, buttonRow]
                });

            } catch (error) {
                console.error('Modal処理エラー:', error);
                await interaction.editReply('❌ フォームの処理中にエラーが発生しました。');
            }
        }
    }

    // セレクトメニューの処理
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'gm_select') {
            const selectedGm = interaction.values;
            
            // グローバルデータに追加
            if (global.tempNotionData && global.tempNotionData.userId === interaction.user.id) {
                global.tempNotionData.selectedGm = selectedGm;
            }

            // 返信なしで更新のみ（ephemeralで返信無効化）
            await interaction.deferUpdate();
        }

        if (interaction.customId === 'pl_select') {
            const selectedPl = interaction.values;
            
            // グローバルデータに追加
            if (global.tempNotionData && global.tempNotionData.userId === interaction.user.id) {
                global.tempNotionData.selectedPl = selectedPl;
            }

            // 返信なしで更新のみ（ephemeralで返信無効化）
            await interaction.deferUpdate();
        }
    }

    // ボタンクリック時の処理
    if (interaction.isButton()) {
        if (interaction.customId === 'confirm_notion_add') {
            try {
                await interaction.deferReply() ;//{ flags: 64 }); // ephemeral flag

                const tempData = global.tempNotionData;
                if (!tempData || tempData.userId !== interaction.user.id) {
                    await interaction.editReply('❌ セッションデータが見つかりません。最初からやり直してください。');
                    return;
                }

                if (!tempData.selectedGm || tempData.selectedGm.length === 0) {
                    await interaction.editReply('❌ GMを選択してください。');
                    return;
                }

                // 選択されたメンバー名を取得
                const selectedGmNames = tempData.selectedGm.map(value => 
                    MEMBERS.find(m => m.value === value)?.label
                ).filter(Boolean);

                const selectedPlNames = tempData.selectedPl.map(value => 
                    MEMBERS.find(m => m.value === value)?.label
                ).filter(Boolean);

                // Discord情報を取得
                const channel = interaction.channel;
                const channelInfo = {
                    channelId: channel.id,
                    channelName: channel.name || 'DM',
                    threadId: channel.isThread() ? channel.id : null,
                    threadName: channel.isThread() ? channel.name : null,
                    parentChannelId: channel.isThread() ? channel.parentId : channel.id,
                    parentChannelName: channel.isThread() ? channel.parent?.name : channel.name,
                    threadUrl: channel.isThread() ? `https://discord.com/channels/${channel.guildId}/${channel.id}` : null
                };

                console.log('📍 Discord情報:', channelInfo);

                // スレッドの場合、別のDBで対応するページを検索
                let relatedThreadPage = null;
                let imageUrl = null;
                if (channelInfo.threadUrl && process.env.NOTION_THREAD_DATABASE_ID) {
                    try {
                        console.log('🔍 スレッドURLで別DBを検索中...', channelInfo.threadUrl);
                        
                        const threadSearchResponse = await notion.databases.query({
                            database_id: process.env.NOTION_THREAD_DATABASE_ID,
                            filter: {
                                property: "スレッドURL", // プロパティ名は実際の名前に変更してください
                                rich_text: {
                                    contains: channelInfo.threadUrl
                                }
                            }
                        });

                        console.log(`🔍 検索結果: ${threadSearchResponse.results.length}件`);

                        if (threadSearchResponse.results.length > 0) {
                            relatedThreadPage = threadSearchResponse.results[0];
                            console.log('✅ 関連スレッドページ発見:', relatedThreadPage.id);
                            
                            // ファイル&メディアプロパティから画像URLを取得
                            try {
                                const pageDetails = await notion.pages.retrieve({
                                    page_id: relatedThreadPage.id
                                });
                                
                                console.log('📄 ページ詳細を取得:', pageDetails.id);
                                
                                // ファイル&メディアプロパティを探す（複数の可能な名前を試す）
                                const possibleFileProperties = ['ファイル&メディア', 'ファイル', 'メディア', 'Files & media', 'Files', 'Media', 'Image', '画像'];
                                
                                for (const propName of possibleFileProperties) {
                                    const fileProperty = pageDetails.properties[propName];
                                    if (fileProperty && fileProperty.type === 'files' && fileProperty.files && fileProperty.files.length > 0) {
                                        const firstFile = fileProperty.files[0];
                                        
                                        // 外部ファイルかNotionファイルかを判定
                                        if (firstFile.type === 'external' && firstFile.external && firstFile.external.url) {
                                            imageUrl = firstFile.external.url;
                                            console.log(`🖼️ 外部画像URL取得 (${propName}):`, imageUrl);
                                            break;
                                        } else if (firstFile.type === 'file' && firstFile.file && firstFile.file.url) {
                                            imageUrl = firstFile.file.url;
                                            console.log(`🖼️ Notion画像URL取得 (${propName}):`, imageUrl);
                                            break;
                                        }
                                    }
                                }
                                
                                if (!imageUrl) {
                                    console.log('⚠️ ファイル&メディアプロパティまたは画像が見つかりませんでした');
                                    console.log('🔍 利用可能なプロパティ:', Object.keys(pageDetails.properties));
                                }
                                
                            } catch (pageError) {
                                console.error('❌ ページ詳細取得エラー:', pageError);
                                // エラーがあっても処理を続行
                            }
                        } else {
                            console.log('⚠️ 関連スレッドページが見つかりませんでした');
                        }
                    } catch (searchError) {
                        console.error('❌ スレッド検索エラー:', searchError);
                        // エラーがあっても処理を続行
                    }
                }

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
                    'GM': {
                        multi_select: selectedGmNames.map(name => ({ name }))
                    },
                    'PL': {
                        multi_select: selectedPlNames.map(name => ({ name }))
                    }
                };

                // 日付が設定されている場合のみ追加
                if (tempData.sessionDate) {
                    notionProperties['日付'] = {
                        date: {
                            start: tempData.sessionDate
                        }
                    };
                }

                // 関連スレッドページがある場合、リレーションを追加
                if (relatedThreadPage) {
                    notionProperties['TRPGシナリオ'] = {
                        relation: [
                            { id: relatedThreadPage.id }
                        ]
                    };
                    console.log('🔗 リレーション設定:', relatedThreadPage.id);
                }

                console.log('📝 送信するNotionプロパティ:', JSON.stringify(notionProperties, null, 2));

                // ページのコンテンツ（本文）を作成
                const pageChildren = [];
                
                // 画像URLがある場合、本文に画像を追加
                if (imageUrl) {
                    pageChildren.push({
                        object: 'block',
                        type: 'image',
                        image: {
                            type: 'external',
                            external: {
                                url: imageUrl
                            }
                        }
                    });
                    console.log('🖼️ ページ本文に画像を追加:', imageUrl);
                }

                const response = await notion.pages.create({
                    parent: {
                        database_id: process.env.NOTION_DATABASE_ID
                    },
                    properties: notionProperties,
                    children: pageChildren  // 本文コンテンツを追加
                });

                // 成功Embed（Notionページリンク付き）
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

                // 画像が本文に追加された場合の表示
                if (imageUrl) {
                    successEmbed.addFields(
                        { name: '🖼️ 画像', value: 'シナリオ画像をページ本文に追加しました', inline: true }
                    );
                    console.log('🖼️ 本文に画像追加完了');
                }

                // スレッド情報があれば追加
                if (channelInfo.threadName) {
                    successEmbed.addFields(
                        { name: '🧵 スレッド', value: channelInfo.threadName, inline: true }
                    );
                }

                // リレーション情報があれば追加
                if (relatedThreadPage) {
                    const relationTitle = relatedThreadPage.properties?.Name?.title?.[0]?.text?.content 
                        || relatedThreadPage.properties?.タイトル?.title?.[0]?.text?.content 
                        || 'シナリオページ';
                    
                    successEmbed.addFields(
                        { name: '🔗 リレーション', value: `${relationTitle} にリンク済み`, inline: true }
                    );
                } else if (channelInfo.threadUrl) {
                    successEmbed.addFields(
                        { name: '⚠️ リレーション', value: '対応するシナリオページが見つかりませんでした', inline: true }
                    );
                }

                successEmbed.setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

                // 一時データをクリア
                delete global.tempNotionData;

                console.log('✅ Notionページ作成成功:', response.id);

            } catch (error) {
                console.error('❌ Notion追加エラー（詳細）:', error);
                console.error('❌ エラーメッセージ:', error.message);
                console.error('❌ エラーコード:', error.code);
                console.error('❌ エラースタック:', error.stack);
                
                // Notion APIエラーの詳細ログ
                if (error.body) {
                    console.error('❌ Notion APIエラー詳細:', JSON.stringify(error.body, null, 2));
                }
                
                let errorMessage = 'Notionへの追加中にエラーが発生しました。';
                
                // 環境変数チェック
                if (!process.env.NOTION_TOKEN) {
                    errorMessage += '\n❌ NOTION_TOKENが設定されていません。';
                }
                if (!process.env.NOTION_DATABASE_ID) {
                    errorMessage += '\n❌ NOTION_DATABASE_IDが設定されていません。';
                }
                
                // Notion APIエラーの分析
                if (error.code === 'unauthorized') {
                    errorMessage += '\n❌ Notion Integration Tokenが無効です。';
                } else if (error.code === 'object_not_found') {
                    errorMessage += '\n❌ Notionデータベースが見つかりません。';
                } else if (error.code === 'validation_error') {
                    errorMessage += '\n❌ Notionプロパティの設定に問題があります。';
                }
                
                await interaction.editReply(errorMessage);
            }
        }

        if (interaction.customId === 'cancel_notion_add') {
            delete global.tempNotionData;
            await interaction.reply({ 
                content: '❌ キャンセルしました。', 
                flags: 64 // ephemeral flag
            });
        }
    }
});

// エラーハンドリング強化
client.on('error', error => {
    console.error('❌ Discordクライアントエラー:', error);
});

client.on('warn', warning => {
    console.warn('⚠️ Discord警告:', warning);
});

client.on('shardError', error => {
    console.error('❌ Discord Shardエラー:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ 予期しないエラー:', error);
    // クリティカルエラーでもプロセスを継続
    console.log('🔄 プロセスを継続します...');
});

process.on('unhandledRejection', error => {
    console.error('❌ 処理されていないPromise拒否:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 SIGTERM受信。グレースフルシャットダウンを開始...');
    server.close(() => {
        console.log('🌐 HTTPサーバーを停止しました');
        client.destroy();
        console.log('🤖 Discordクライアントを停止しました');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📴 SIGINT受信。グレースフルシャットダウンを開始...');
    server.close(() => {
        console.log('🌐 HTTPサーバーを停止しました');
        client.destroy();
        console.log('🤖 Discordクライアントを停止しました');
        process.exit(0);
    });
});

// ボットにログイン
console.log('🚀 ボットを起動中...');
client.login(process.env.BOT_TOKEN).catch(error => {
    console.error('❌ ボットログインエラー:', error);
    process.exit(1);
});