export function isDiscordWebhookConfigured(): boolean {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    return Boolean(webhookUrl && webhookUrl.trim().length > 0);
}

export async function getDiscordWebhookStatus(): Promise<{ configured: boolean }> {
    return { configured: isDiscordWebhookConfigured() };
}

export async function logToDiscord(title: string, message: string, color: number = 3447003, mention: boolean = false) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
        const roleId = process.env.DISCORD_ROLE_ID;
        const payload: { embeds: Array<{ title: string; description: string; color: number; timestamp: string }>; content?: string } = {
            embeds: [{
                title,
                description: message,
                color,
                timestamp: new Date().toISOString()
            }]
        };
        if (mention && roleId) {
            payload.content = `<@&${roleId}>`;
        }
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error('Failed to send discord log:', e);
    }
}
