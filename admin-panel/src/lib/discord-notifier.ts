export function isDiscordWebhookConfigured(): boolean {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    return Boolean(webhookUrl && webhookUrl.trim().length > 0);
}

export async function getDiscordWebhookStatus(): Promise<{ configured: boolean }> {
    return { configured: isDiscordWebhookConfigured() };
}

/**
 * Posts one embed to the configured webhook and reports whether the receiver accepted it.
 *
 * WHY it returns a boolean and does not throw: every existing caller treats a notification as best
 * effort — a backup that succeeded must not be marked failed because Discord was down — so throwing
 * would change their behaviour. But the security channel deduplicates on "this fact was told to a
 * human", and a message that never arrived must not be recorded as delivered: the caller checks the
 * result and only then writes its record. `false` means "not delivered" for every reason (no
 * webhook configured, a rejected POST, a DNS failure), and the caller retries on its next tick.
 *
 * WHY `response.ok` and not just "fetch resolved": a 404 on a rotated webhook resolves with an error
 * body, and treating that as delivered is how a channel goes quiet without anyone noticing.
 */
export async function logToDiscord(title: string, message: string, color: number = 3447003, mention: boolean = false): Promise<boolean> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return false;

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
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.error(`Failed to send discord log: HTTP ${String(response.status)}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error('Failed to send discord log:', e);
        return false;
    }
}
