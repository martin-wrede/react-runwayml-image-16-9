export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Runway-Version' } });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!env.RUNWAYML_API_KEY) {
    const errorMsg = 'CRITICAL FIX REQUIRED: Check Cloudflare project settings for API Key.';
    console.error(errorMsg);
    return new Response(JSON.stringify({ success: false, error: errorMsg }), { status: 500 });
  }

  const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';
  const COMMON_HEADERS = {
    'Authorization': `Bearer ${env.RUNWAYML_API_KEY}`,
    'X-Runway-Version': '2024-11-06',
    'Content-Type': 'application/json'
  };

  try {
    const contentType = request.headers.get('content-type') || '';

    // ... (multipart/form-data and other cases remain the same) ...

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const prompt = formData.get('prompt');
      const imageFile = formData.get('image');
      const duration = parseInt(formData.get('duration') || '5', 10);
      const ratio = formData.get('ratio') || '1280:720';
      
      if (!prompt || !imageFile) throw new Error('Request is missing prompt or image file.');

      // Convert image to base64 data URL for Runway
      const arrayBuffer = await imageFile.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const imageDataUrl = `data:${imageFile.type};base64,${base64}`;
      
      return await startImageToVideoJob(imageDataUrl, prompt, duration, ratio, imageFile.name, env);
    }
    
    else if (contentType.includes('application/json')) {
      const body = await request.json();
      const { action } = body;

      switch (action) {
        case 'generateImage': {
          const { prompt, ratio } = body;
          if (!prompt) throw new Error('Image prompt is missing.');
          const runwayResponse = await fetch(`${RUNWAY_API_BASE}/text_to_image`, {
            method: 'POST',
            headers: COMMON_HEADERS,
            body: JSON.stringify({
              model: 'gen4_image',
              promptText: prompt,
              ratio: ratio || '1280:720',
              seed: Math.floor(Math.random() * 4294967295),
            }),
          });
          const data = await runwayResponse.json();
          if (!runwayResponse.ok) throw new Error(data.error || `Runway T2I API error: ${runwayResponse.status}`);
          // Store task metadata without R2
          if (env.TASK_INFO_KV) {
            await env.TASK_INFO_KV.put(data.id, JSON.stringify({ type: 'image' }));
          }
          return jsonResponse({ success: true, taskId: data.id });
        }
        
        case 'startVideoFromUrl': {
          // This part works, so no changes needed here
          const { videoPrompt, imageUrl, duration, ratio } = body;
          if (!videoPrompt || !imageUrl) throw new Error("Missing video prompt or image URL.");
          return await startImageToVideoJob(imageUrl, videoPrompt, parseInt(duration || '5', 10), ratio || '1280:720', 'generated-image', env);
        }

        // --- B3. Poll for status of any task (WITH ADDED LOGGING) ---
        case 'status': {
          const { taskId } = body;
          if (!taskId) throw new Error('Invalid status check request.');
          
          const statusUrl = `${RUNWAY_API_BASE}/tasks/${taskId}`;
          const response = await fetch(statusUrl, { headers: { ...COMMON_HEADERS, 'Content-Type': undefined } });
          const data = await response.json();
          
          if (!response.ok) throw new Error(`Status check failed: ${data.error || response.statusText}`);

          if (data.status === 'SUCCEEDED' && data.output?.[0]) {
            console.log(`[${taskId}] Task SUCCEEDED. Returning Runway URL directly.`);
            
            // Get task type from KV if available
            let taskType = 'video';
            if (env.TASK_INFO_KV) {
              const taskInfo = await env.TASK_INFO_KV.get(taskId, { type: 'json' });
              if (taskInfo?.type) taskType = taskInfo.type;
              context.waitUntil(env.TASK_INFO_KV.delete(taskId));
            }
            
            const runwayOutputUrl = data.output[0];
            console.log(`[${taskId}] Returning URL: ${runwayOutputUrl}`);
            
            const successPayload = { success: true, status: data.status, progress: data.progress };
            if (taskType === 'image') {
              successPayload.imageUrl = runwayOutputUrl;
            } else {
              successPayload.videoUrl = runwayOutputUrl;
            }
            return jsonResponse(successPayload);
          }

          // Return progress status if not yet succeeded
          return jsonResponse({ success: true, status: data.status, progress: data.progress });
        }
        default:
          throw new Error('Invalid action specified.');
      }
    } 
    else { throw new Error(`Invalid request content-type.`); }
  } catch (error) {
    console.error('Caught a top-level error:', error.message); // Added more context to error logging
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}

// ... (helper functions remain the same) ...
async function startImageToVideoJob(imageUrl, prompt, duration, ratio, originalName, env) {
  const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';

  const response = await fetch(`${RUNWAY_API_BASE}/image_to_video`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RUNWAYML_API_KEY}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gen4_turbo',
      promptText: prompt,
      promptImage: imageUrl,
      seed: Math.floor(Math.random() * 4294967295),
      watermark: false,
      duration: duration,
      ratio: ratio
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Runway I2V API returned status ${response.status}`);
  
  // Store task metadata without R2
  if (env.TASK_INFO_KV) {
    await env.TASK_INFO_KV.put(data.id, JSON.stringify({ type: 'video' }));
  }

  return jsonResponse({ success: true, taskId: data.id, status: data.status });
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}