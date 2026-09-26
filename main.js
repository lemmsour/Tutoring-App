document.addEventListener('DOMContentLoaded', () => {
  const landingPage = document.getElementById('landing-page');
  const playerPage = document.getElementById('player-page');
  const fileInput = document.getElementById('file-input');
  const fileBadge = document.getElementById('file-count-badge');
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');
  const pulseCircle = document.getElementById('pulse-circle');
  const handIcon = document.getElementById('hand-icon');
  const statusText = document.getElementById('status-text');
  const audioPlayer = document.getElementById('audio-player');

  let selectedFiles = [];
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let clickTimer = null;

  fileInput.addEventListener('change', (e) => {
    selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      fileBadge.textContent = `${selectedFiles.length} file(s) selected`;
      fileBadge.classList.remove('hidden');
    } else {
      fileBadge.classList.add('hidden');
    }
  });

  sendBtn.addEventListener('click', async () => {
    const promptText = promptInput.value.trim();
    
    landingPage.classList.remove('active');
    playerPage.classList.add('active');
    statusText.textContent = 'Generating lesson with Gemini & ElevenLabs...';
    pulseCircle.classList.add('paused');

    const formData = new FormData();
    formData.append('prompt', promptText);
    selectedFiles.forEach(file => formData.append('files', file));

    try {
      const response = await fetch('http://localhost:3000/api/generate-podcast', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Failed to generate audio');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      audioPlayer.src = audioUrl;
      statusText.textContent = '';
      
      audioPlayer.play();
      pulseCircle.classList.remove('paused');
      pulseCircle.classList.add('playing');

    } catch (err) {
      console.error(err);
      statusText.textContent = 'Error generating podcast. Please try again.';
    }
  });

  audioPlayer.addEventListener('play', () => {
    pulseCircle.classList.remove('paused');
    pulseCircle.classList.add('playing');
  });

  audioPlayer.addEventListener('pause', () => {
    pulseCircle.classList.remove('playing');
    pulseCircle.classList.add('paused');
  });

  audioPlayer.addEventListener('ended', () => {
    pulseCircle.classList.remove('playing');
    pulseCircle.classList.add('paused');
  });

  pulseCircle.addEventListener('click', (e) => {
    if (clickTimer == null) {
      clickTimer = setTimeout(() => {
        clickTimer = null;
        handleSingleClick();
      }, 300);
    } else {
      clearTimeout(clickTimer);
      clickTimer = null;
      handleDoubleClick();
    }
  });

  function handleSingleClick() {
    if (isRecording) return;
    
    if (audioPlayer.paused) {
      audioPlayer.play();
    } else {
      audioPlayer.pause();
    }
  }

  async function handleDoubleClick() {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecordingAndSend();
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };

      mediaRecorder.onstop = sendRecordedAudio;

      mediaRecorder.start();
      isRecording = true;
      
      audioPlayer.pause();

      pulseCircle.classList.add('recording');
      handIcon.classList.remove('hidden');
      statusText.textContent = 'Listening... (Double click to stop & send)';
    } catch (err) {
      console.error('Microphone access denied:', err);
      statusText.textContent = 'Microphone access denied.';
    }
  }

  function stopRecordingAndSend() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      
      pulseCircle.classList.remove('recording');
      handIcon.classList.add('hidden');
      statusText.textContent = 'Processing your question...';
    }
  }

  async function sendRecordedAudio() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'question.wav');

    try {
      const response = await fetch('http://localhost:3000/api/ask-question', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Error processing audio question');

      const responseAudioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(responseAudioBlob);

      audioPlayer.src = audioUrl;
      statusText.textContent = '';
      audioPlayer.play();

    } catch (err) {
      console.error(err);
      statusText.textContent = 'Error sending question. Try again.';
    }
  }
});