export async function onRequest(context) {
  const { request, env } = context;

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Runway-Version' } });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Check for API Key
  if (!env.RUNWAYML_API_KEY) {
    const errorMsg = 'CRITICAL FIX REQUIRED: Check Cloudflare project settings for RUNWAYML_API_KEY.';
    console.error(errorMsg);
    return jsonResponse({ success: false, error: errorMsg }, 500);
  }

  const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';
  const COMMON_HEADERS = {
    'Authorization': `Bearer ${env.RUNWAYML_API_KEY}`,
    'X-Runway-Version': '2024-11-06',
    'Content-Type': 'application/json'
  };

  try {
    const contentType = request.headers.get('content-type') || '';

    // --- Handle Image Upload to start Image-to-Image task ---
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const prompt = formData.get('prompt');
      const imageFile = formData.get('image');
      const ratio = formData.get('ratio') || '1280:720';
      
      if (!prompt || !imageFile) {
        throw new Error('Request is missing prompt or image file.');
      }

      const arrayBuffer = await imageFile.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(arrayBuffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const imageDataUrl = `data:${imageFile.type};base64,${base64}`;
      
      // Call the RunwayML API to start the generation job
      const runwayResponse = await fetch(`${RUNWAY_API_BASE}/text_to_image`, {
        method: 'POST',
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          model: 'gen4_image',
          promptText: prompt,
          promptImage: imageDataUrl,
          ratio: ratio,
          // --- FIX: Add this line to control the image modification ---
          structure_strength: 0.85, // Value between 0 and 1. Higher means more like the original image.
          // ---
          seed: Math.floor(Math.random() * 4294967295),
        }),
      });

      const data = await runwayResponse.json();
      if (!runwayResponse.ok) {
        throw new Error(data.error || `Runway API Error: ${runwayResponse.status}`);
      }
      
      return jsonResponse({ success: true, taskId: data.id });
    }
    
    // --- Handle JSON requests for polling status ---
    else if (contentType.includes('application/json')) {
      const body = await request.json();
      const { action, taskId } = body;

      if (action === 'status') {
        if (!taskId) throw new Error('Task ID is missing for status check.');
        
        const statusUrl = `${RUNWAY_API_BASE}/tasks/${taskId}`;
        const response = await fetch(statusUrl, { 
          headers: { 'Authorization': COMMON_HEADERS.Authorization, 'X-Runway-Version': COMMON_HEADERS['X-Runway-Version'] }
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(`Status check failed: ${data.error || response.statusText}`);
        }

        if (data.status === 'SUCCEEDED') {
          if (data.output && data.output[0]) {
            return jsonResponse({ 
              success: true, 
              status: data.status, 
              progress: data.progress, 
              imageUrl: data.output[0]
            });
          } else {
            return jsonResponse({ success: false, status: 'FAILED', error: 'Task succeeded but output was empty.' });
          }
        }

        return jsonResponse({ success: true, status: data.status, progress: data.progress });

      } else {
        throw new Error('Invalid action specified.');
      }
    } 
    else { 
      throw new Error(`Invalid request content-type: ${contentType}`); 
    }
  } catch (error) {
    console.error('Caught a top-level error:', error.message);
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}

// Helper function to create a JSON response
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        }
    });
}