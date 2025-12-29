import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const { text, voice } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Get the absolute path to the project root
    const projectRoot = path.resolve(process.cwd(), '..');

    // Handle default voice
    const voicePath = voice === 'default' ? '' : voice || '';

    return new Promise((resolve) => {
      // Call the Python TTS service using the virtual environment
      const pythonProcess = spawn(path.join(projectRoot, 'venv/bin/python3'), [path.join(projectRoot, 'tts_service.py'), text, voicePath], {
        cwd: projectRoot,
        env: {
          ...process.env,
          PYTHONPATH: projectRoot,
        }
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error('Python process error:', stderr);
          resolve(NextResponse.json({ error: 'TTS generation failed' }, { status: 500 }));
          return;
        }

        try {
          // Extract JSON from stdout by finding the last line (which should be the JSON response)
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1].trim();
          
          // Try to parse the last line as JSON
          const result = JSON.parse(lastLine);
          resolve(NextResponse.json(result));
        } catch (parseError) {
          console.error('Failed to parse TTS response:', stdout);
          resolve(NextResponse.json({ error: 'Invalid response from TTS service' }, { status: 500 }));
        }
      });

      pythonProcess.on('error', (error) => {
        console.error('Failed to start Python process:', error);
        resolve(NextResponse.json({ error: 'Failed to start TTS service' }, { status: 500 }));
      });
    });

  } catch (error) {
    console.error('TTS API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}