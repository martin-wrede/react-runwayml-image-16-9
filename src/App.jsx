import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  // State for the new Image-to-Image workflow
  const [prompt, setPrompt] = useState('');
  const [modifiedImageUrl, setModifiedImageUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [ratio, setRatio] = useState('1280:720'); // Default to Landscape

  const pollIntervalRef = useRef(null);

  useEffect(() => {
    // Cleanup interval on component unmount
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Resets state, clearing previous results
  const resetState = () => {
    setModifiedImageUrl(null);
    setIsGenerating(false);
    setProgress(0);
    setStatus('');
    setError('');
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      resetState(); // Clear previous results when a new file is selected
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        setError('Please select a valid image format (JPEG, PNG, WebP)');
        return;
      }
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        setError('The file is too large. Maximum 10MB allowed.');
        return;
      }
      setSelectedFile(file);
      setError('');
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    resetState();
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.value = '';
  };

  // Polling function to check the status of the image generation task
  const pollForStatus = (taskId) => {
    pollIntervalRef.current = setInterval(async () => {
      try {
        const statusResponse = await fetch('/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, action: 'status' }),
        });

        const statusData = await statusResponse.json();
        if (!statusResponse.ok || !statusData.success) {
          throw new Error(statusData.error || 'Failed to check task status');
        }

        const progressPercentage = (statusData.progress * 100) || 0;
        setStatus(`Status: ${statusData.status} (${progressPercentage.toFixed(0)}%)`);
        setProgress(progressPercentage);

        if (statusData.status === 'SUCCEEDED') {
          clearInterval(pollIntervalRef.current);
          if (statusData.imageUrl) {
            setModifiedImageUrl(statusData.imageUrl);
            setStatus('Image generation completed!');
          } else {
            throw new Error('Task succeeded but no image URL was returned.');
          }
          setIsGenerating(false);
        } else if (statusData.status === 'FAILED') {
          throw new Error(statusData.failure?.reason || 'Image generation failed');
        }
      } catch (pollError) {
        setError(pollError.message);
        setIsGenerating(false);
        clearInterval(pollIntervalRef.current);
      }
    }, 4000);
  };

  // Function to start the image modification process
  const generateModifiedImage = async () => {
    if (!selectedFile || !prompt.trim()) {
      setError('Please upload an image and provide a modification prompt.');
      return;
    }

    resetState();
    setIsGenerating(true);
    setStatus('Uploading image and starting job...');

    try {
      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('image', selectedFile);
      formData.append('ratio', ratio);

      const response = await fetch('/ai', { method: 'POST', body: formData });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to start image modification');
      }

      setStatus('Job started, processing image...');
      pollForStatus(data.taskId);

    } catch (err) {
      setError(err.message);
      setIsGenerating(false);
    }
  };

  // Reusable styles
  const radioGroupStyle = { marginBottom: '20px', border: '1px solid #ccc', padding: '10px', borderRadius: '5px' };
  const radioLabelStyle = { marginRight: '15px', cursor: 'pointer' };
  const sectionStyle = { border: '1px solid #ddd', padding: '15px', borderRadius: '5px', marginBottom: '20px' };

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1>Image-to-Image with RunwayML</h1>

      {/* --- STEP 1: UPLOAD IMAGE --- */}
      <div style={sectionStyle}>
        <h3>Step 1: Upload a Source Image</h3>
        <input id="fileInput" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} style={{ width: '100%' }} />
        {previewUrl && (
          <div style={{ marginTop: '15px', position: 'relative', display: 'inline-block' }}>
            <p><strong>Image Preview:</strong></p>
            <img src={previewUrl} alt="Preview" style={{ maxWidth: '300px', maxHeight: '200px', border: '1px solid #ddd' }} />
            <button onClick={removeFile} style={{ position: 'absolute', top: '5px', right: '5px', background: 'rgba(255,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: '25px', height: '25px', cursor: 'pointer' }}>×</button>
          </div>
        )}
      </div>

      {/* --- STEP 2: MODIFY IMAGE --- */}
      {selectedFile && (
        <>
          <div style={sectionStyle}>
            <h3>Step 2: Describe Your Modifications</h3>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Modification Prompt:</label>
              <input type="text" placeholder="e.g., 'make it look like a watercolor painting'" value={prompt} onChange={e => setPrompt(e.target.value)} style={{ width: '100%', padding: '10px', fontSize: '16px', boxSizing: 'border-box' }} />
            </div>

            <div style={radioGroupStyle}>
              <p style={{ marginTop: 0, fontWeight: 'bold' }}>Aspect Ratio:</p>
              <label style={radioLabelStyle}><input type="radio" value="1280:720" checked={ratio === '1280:720'} onChange={() => setRatio('1280:720')} /> Landscape (16:9)</label>
              <label style={radioLabelStyle}><input type="radio" value="720:1280" checked={ratio === '720:1280'} onChange={() => setRatio('720:1280')} /> Portrait (9:16)</label>
            </div>

            <button onClick={generateModifiedImage} disabled={isGenerating || !prompt.trim()} style={{ padding: '10px 20px', fontSize: '16px', backgroundColor: (isGenerating || !prompt.trim()) ? '#ccc' : '#007bff', color: 'white', border: 'none', cursor: 'pointer' }}>
              {isGenerating ? 'Generating...' : 'Generate Modified Image'}
            </button>
          </div>
        </>
      )}

      {/* --- STATUS AND RESULTS --- */}
      {status && (
        <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f0f0f0' }}>
          <p>{status}</p>
          {isGenerating && progress > 0 && (
            <div style={{ backgroundColor: '#ddd' }}><div style={{ width: `${progress}%`, height: '20px', backgroundColor: '#007bff', transition: 'width 0.5s ease' }} /></div>
          )}
        </div>
      )}

      {error && (<div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#ffebee', color: '#c62828' }}>Error: {error}</div>)}

      {modifiedImageUrl && (
        <div style={{ marginTop: '20px' }}>
          <h3>Generated Image:</h3>
          <img src={modifiedImageUrl} alt="Generated result from RunwayML" style={{ width: '100%', maxWidth: '500px', border: '1px solid #ddd' }} />
        </div>
      )}

      <div style={{ marginTop: '30px', fontSize: '14px', color: '#666' }}>
        <p><strong>Model:</strong> gen4_image (Image-to-Image)</p>
      </div>
    </div>
  );
}