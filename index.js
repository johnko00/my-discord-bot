// 必要なライブラリを読み込み
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const express = require('express');
require('dotenv').config(); // .envファイルを読み込み

// ボットクライアントの作成
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // サーバー情報の取得
        GatewayIntentBits.GuildMessages, // メッセージの読み取り
        GatewayIntentBits.MessageContent // メッセージ内容の読み取り
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
                type: 6, // USER type
                required: false
            }
        ]
    },
    {
        name: 'serverinfo',
        description: 'サーバーの情報を表示します'
    }
];

// ボット起動時の処理（統合版）
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がオンラインになりました！`);
    console.log(`🔗 ${client.guilds.cache.size}個のサーバーに接続中`);

    // スラッシュコマンドを登録
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    
    try {
        console.log('🗑️ 古いコマンドを削除中...');
        // 全てのグローバルコマンドを削除
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [] }
        );
        console.log('✅ 古いコマンド削除完了！');
        
        console.log('🔄 新しいコマンドを登録中...');
        // 新しいコマンドを登録
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
    // スラッシュコマンド以外は無視
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        switch (commandName) {
            case 'ping':
                // ボットの応答速度を測定
                const ping = client.ws.ping;
                await interaction.reply(`🏓 Pong! レイテンシ: ${ping}ms`);
                break;

            case 'hello':
                // 挨拶コマンド
                const user = interaction.options.getUser('user');
                const message = user
                    ? `👋 こんにちは、${user}さん！`
                    : `👋 こんにちは、${interaction.user}さん！`;
                await interaction.reply(message);
                break;

            case 'serverinfo':
                // サーバー情報を表示
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

            default:
                await interaction.reply('❌ 未知のコマンドです。');
        }
    } catch (error) {
        console.error('コマンド実行エラー:', error);
        // エラーレスポンス
        if (interaction.replied) {
            await interaction.followUp('❌ コマンドの実行中にエラーが発生しました。');
        } else {
            await interaction.reply('❌ コマンドの実行中にエラーが発生しました。');
        }
    }
});

// エラーハンドリング
client.on('error', error => {
    console.error('❌ Discordクライアントエラー:', error);
});

// プロセスエラーハンドリング
process.on('uncaughtException', error => {
    console.error('❌ 予期しないエラー:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ 処理されていないPromise拒否:', error);
});

// Render用のWebサーバー（ポートバインド対応）
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

// サーバー起動（エラーハンドリング付き）
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