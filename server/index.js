const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { nanoid } = require('nanoid');
const play = require('play-dl');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// In-memory storage for rooms
const rooms = new Map();

// Generate a unique room ID
function generateRoomId() {
  return nanoid(8);
}

// Average song duration in seconds (used for ETA when actual duration unknown)
const DEFAULT_SONG_DURATION = 210; // 3.5 minutes

// Format duration in seconds to MM:SS
function formatDuration(seconds) {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Create a new room
function createRoom(hostName) {
  const roomId = generateRoomId();
  const adminToken = nanoid(16);
  
  rooms.set(roomId, {
    id: roomId,
    adminToken,
    hostName,
    queue: [],
    fallbackPlaylist: [],
    fallbackIndex: 0,
    currentSong: null,
    currentSongStartedAt: null,
    isPlaying: false,
    isPlayingFallback: false,
    createdAt: new Date()
  });
  
  return { roomId, adminToken };
}

// Get room by ID
function getRoom(roomId) {
  return rooms.get(roomId);
}

// YouTube Search endpoint using play-dl (no API key required, no quota limits)
app.get('/api/youtube/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Search query is required' });
  }
  
  try {
    const searchResults = await play.search(q, { limit: 10, source: { youtube: 'video' } });
    
    const results = searchResults.map(item => ({
      videoId: item.id,
      title: item.title,
      thumbnail: item.thumbnails?.[0]?.url,
      channel: item.channel?.name || 'Unknown',
      duration: formatDuration(item.durationInSec),
      views: item.views
    }));
    
    res.json(results);
  } catch (error) {
    console.error('YouTube search error:', error);
    res.status(500).json({ error: 'Failed to search YouTube. Please try again.' });
  }
});

// YouTube Playlist endpoint - fetch all videos from a playlist
app.get('/api/youtube/playlist', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Playlist URL is required' });
  }
  
  try {
    // Validate it's a playlist URL
    const urlType = await play.validate(url);
    if (urlType !== 'yt_playlist') {
      return res.status(400).json({ error: 'Invalid YouTube playlist URL' });
    }
    
    const playlist = await play.playlist_info(url, { incomplete: true });
    const videos = await playlist.all_videos();
    
    const results = videos.map(item => ({
      videoId: item.id,
      title: item.title,
      thumbnail: item.thumbnails?.[0]?.url,
      channel: item.channel?.name || 'Unknown',
      duration: formatDuration(item.durationInSec)
    }));
    
    res.json({
      title: playlist.title,
      videoCount: playlist.videoCount,
      videos: results
    });
  } catch (error) {
    console.error('YouTube playlist error:', error);
    res.status(500).json({ error: 'Failed to fetch playlist. Please check the URL and try again.' });
  }
});

// API Routes
app.post('/api/rooms', (req, res) => {
  const { hostName } = req.body;
  const { roomId, adminToken } = createRoom(hostName || 'DJ');
  res.json({ roomId, adminToken });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  // Return public room data (without admin token)
  res.json({
    id: room.id,
    hostName: room.hostName,
    queue: room.queue,
    currentSong: room.currentSong,
    currentSongStartedAt: room.currentSongStartedAt,
    isPlaying: room.isPlaying,
    isPlayingFallback: room.isPlayingFallback
  });
});

app.get('/api/rooms/:roomId/admin', (req, res) => {
  const room = getRoom(req.params.roomId);
  const adminToken = req.headers['x-admin-token'];
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (room.adminToken !== adminToken) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  
  res.json(room);
});

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join a room
  socket.on('join-room', (roomId) => {
    const room = getRoom(roomId);
    if (room) {
      socket.join(roomId);
      socket.roomId = roomId;
      console.log(`User ${socket.id} joined room ${roomId}`);
      
      // Send current room state
      socket.emit('room-state', {
        queue: room.queue,
        currentSong: room.currentSong,
        isPlaying: room.isPlaying
      });
    }
  });
  
  // Add song to queue
  socket.on('add-song', ({ roomId, song }) => {
    const room = getRoom(roomId);
    if (room) {
      const songWithId = {
        ...song,
        id: nanoid(10),
        addedAt: new Date(),
        addedBy: song.addedBy || 'Guest'
      };
      room.queue.push(songWithId);
      
      io.to(roomId).emit('queue-updated', room.queue);
      console.log(`Song added to room ${roomId}:`, song.title);
    }
  });
  
  // Admin: Remove song from queue
  socket.on('remove-song', ({ roomId, songId, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      room.queue = room.queue.filter(s => s.id !== songId);
      io.to(roomId).emit('queue-updated', room.queue);
    }
  });
  
  // Admin: Reorder queue
  socket.on('reorder-queue', ({ roomId, queue, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      room.queue = queue;
      io.to(roomId).emit('queue-updated', room.queue);
    }
  });
  
  // Admin: Play next song
  socket.on('play-next', ({ roomId, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      if (room.queue.length > 0) {
        room.currentSong = room.queue.shift();
        room.currentSongStartedAt = new Date();
        room.isPlaying = true;
        room.isPlayingFallback = false;
        io.to(roomId).emit('now-playing', { song: room.currentSong, startedAt: room.currentSongStartedAt, isPlayingFallback: false });
        io.to(roomId).emit('queue-updated', room.queue);
      } else if (room.fallbackPlaylist.length > 0) {
        room.currentSong = room.fallbackPlaylist[room.fallbackIndex];
        room.currentSongStartedAt = new Date();
        room.fallbackIndex = (room.fallbackIndex + 1) % room.fallbackPlaylist.length;
        room.isPlaying = true;
        room.isPlayingFallback = true;
        io.to(roomId).emit('now-playing', { song: room.currentSong, startedAt: room.currentSongStartedAt, isPlayingFallback: true });
        io.to(roomId).emit('fallback-index-updated', room.fallbackIndex);
      }
    }
  });
  
  // Admin: Set current song
  socket.on('set-current-song', ({ roomId, song, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      room.currentSong = song;
      room.currentSongStartedAt = new Date();
      room.isPlaying = true;
      room.isPlayingFallback = false;
      io.to(roomId).emit('now-playing', { song: room.currentSong, startedAt: room.currentSongStartedAt, isPlayingFallback: false });
    }
  });
  
  // Admin: Add song to fallback playlist
  socket.on('add-to-fallback', ({ roomId, song, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      const songWithId = {
        ...song,
        id: nanoid(10),
        addedAt: new Date()
      };
      room.fallbackPlaylist.push(songWithId);
      io.to(roomId).emit('fallback-updated', room.fallbackPlaylist);
    }
  });
  
  // Admin: Remove song from fallback playlist
  socket.on('remove-from-fallback', ({ roomId, songId, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      room.fallbackPlaylist = room.fallbackPlaylist.filter(s => s.id !== songId);
      if (room.fallbackIndex >= room.fallbackPlaylist.length) {
        room.fallbackIndex = 0;
      }
      io.to(roomId).emit('fallback-updated', room.fallbackPlaylist);
    }
  });
  
  // Admin: Reorder fallback playlist
  socket.on('reorder-fallback', ({ roomId, playlist, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      room.fallbackPlaylist = playlist;
      io.to(roomId).emit('fallback-updated', room.fallbackPlaylist);
    }
  });
  
  // Admin: Toggle play/pause
  socket.on('toggle-play', ({ roomId, isPlaying, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      room.isPlaying = isPlaying;
      io.to(roomId).emit('play-state-changed', isPlaying);
    }
  });
  
  // Admin: Song ended, auto-play next (or fallback)
  socket.on('song-ended', ({ roomId, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      if (room.queue.length > 0) {
        // Play from guest queue
        room.currentSong = room.queue.shift();
        room.currentSongStartedAt = new Date();
        room.isPlaying = true;
        room.isPlayingFallback = false;
        io.to(roomId).emit('now-playing', { song: room.currentSong, startedAt: room.currentSongStartedAt, isPlayingFallback: false });
        io.to(roomId).emit('queue-updated', room.queue);
      } else if (room.fallbackPlaylist.length > 0) {
        // Play from fallback playlist
        room.currentSong = room.fallbackPlaylist[room.fallbackIndex];
        room.currentSongStartedAt = new Date();
        room.fallbackIndex = (room.fallbackIndex + 1) % room.fallbackPlaylist.length;
        room.isPlaying = true;
        room.isPlayingFallback = true;
        io.to(roomId).emit('now-playing', { song: room.currentSong, startedAt: room.currentSongStartedAt, isPlayingFallback: true });
        io.to(roomId).emit('fallback-index-updated', room.fallbackIndex);
      } else {
        room.currentSong = null;
        room.currentSongStartedAt = null;
        room.isPlaying = false;
        room.isPlayingFallback = false;
        io.to(roomId).emit('now-playing', { song: null, startedAt: null, isPlayingFallback: false });
      }
    }
  });
  
  // Admin: Skip current song
  socket.on('skip-song', ({ roomId, adminToken }) => {
    const room = getRoom(roomId);
    if (room && room.adminToken === adminToken) {
      if (room.queue.length > 0) {
        room.currentSong = room.queue.shift();
        room.currentSongStartedAt = new Date();
        room.isPlaying = true;
        room.isPlayingFallback = false;
        io.to(roomId).emit('now-playing', { song: room.currentSong, startedAt: room.currentSongStartedAt, isPlayingFallback: false });
        io.to(roomId).emit('queue-updated', room.queue);
      } else if (room.fallbackPlaylist.length > 0) {
        room.currentSong = room.fallbackPlaylist[room.fallbackIndex];
        room.currentSongStartedAt = new Date();
        room.fallbackIndex = (room.fallbackIndex + 1) % room.fallbackPlaylist.length;
        room.isPlaying = true;
        room.isPlayingFallback = true;
        io.to(roomId).emit('now-playing', { song: room.currentSong, startedAt: room.currentSongStartedAt, isPlayingFallback: true });
        io.to(roomId).emit('fallback-index-updated', room.fallbackIndex);
      } else {
        room.currentSong = null;
        room.currentSongStartedAt = null;
        room.isPlaying = false;
        room.isPlayingFallback = false;
        io.to(roomId).emit('now-playing', { song: null, startedAt: null, isPlayingFallback: false });
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
