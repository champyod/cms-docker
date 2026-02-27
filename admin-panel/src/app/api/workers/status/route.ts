import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { host, port } = await request.json();

    // Check if container is running
    let containerRunning = false;
    try {
      const { stdout } = await execPromise(`docker ps --filter "name=${host}" --format "{{.Names}}"`);
      containerRunning = stdout.trim().length > 0;
    } catch {}

    // Determine status
    let status = 'unknown';
    if (containerRunning) {
      // Check if container is actually responding
      try {
        const { stdout } = await execPromise(`docker exec ${host} pgrep -f cmsWorker`);
        status = stdout.trim() ? 'idle' : 'disconnected';
      } catch {
        status = 'disconnected';
      }
    } else {
      status = 'disconnected';
    }

    return NextResponse.json({
      status,
      containerRunning,
      host,
      port
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to check worker status', status: 'unknown', containerRunning: false },
      { status: 500 }
    );
  }
}
