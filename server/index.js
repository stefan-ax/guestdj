const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { nanoid } = require('nanoid');
const { search: youtubeSearch } = require('youtube-search-without-api-key');

const app = express();

// Search cache to reduce API calls
const searchCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 1000;

// Rate limiting protection
const rateLimitState = {
  lastRequestTime: 0,
  requestCount: 0,
  windowStart: Date.now(),
  isRateLimited: false,
  rateLimitResetTime: 0
};

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 50; // Conservative limit
const RATE_LIMIT_DURATION = 5 * 60 * 1000; // 5 minutes cooldown
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

// Cache management functions
function getCacheKey(query) {
  return `search:${query.toLowerCase().trim()}`;
}

function getCachedResult(query) {
  const key = getCacheKey(query);
  const cached = searchCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  if (cached) {
    searchCache.delete(key);
  }
  
  return null;
}

function setCachedResult(query, data) {
  const key = getCacheKey(query);
  
  // Clean old cache entries if we're at max size
  if (searchCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  
  searchCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

// Rate limiting functions
function checkRateLimit() {
  const now = Date.now();
  
  // Check if we're currently rate limited
  if (rateLimitState.isRateLimited && now < rateLimitState.rateLimitResetTime) {
    return { allowed: false, retryAfter: rateLimitState.rateLimitResetTime - now };
  }
  
  // Reset rate limit state if cooldown period has passed
  if (rateLimitState.isRateLimited && now >= rateLimitState.rateLimitResetTime) {
    rateLimitState.isRateLimited = false;
    rateLimitState.requestCount = 0;
    rateLimitState.windowStart = now;
  }
  
  // Reset window if needed
  if (now - rateLimitState.windowStart >= RATE_LIMIT_WINDOW) {
    rateLimitState.requestCount = 0;
    rateLimitState.windowStart = now;
  }
  
  // Check if we're exceeding rate limits
  if (rateLimitState.requestCount >= MAX_REQUESTS_PER_WINDOW) {
    rateLimitState.isRateLimited = true;
    rateLimitState.rateLimitResetTime = now + RATE_LIMIT_DURATION;
    return { allowed: false, retryAfter: RATE_LIMIT_DURATION };
  }
  
  // Allow request and increment counter
  rateLimitState.requestCount++;
  rateLimitState.lastRequestTime = now;
  return { allowed: true };
}

// Exponential backoff retry function
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Don't retry on certain errors
      if (error.message.includes('Invalid') || error.message.includes('Not found')) {
        throw error;
      }
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw error;
      }
      
      // Wait with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`Search attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// YouTube search using youtube-search-without-api-key
async function performYouTubeSearch(query, options = {}) {
  try {
    console.log(`Searching YouTube for query: "${query}"`);
    const results = await youtubeSearch(query);
    
    if (!results || results.length === 0) {
      throw new Error('No search results found');
    }
    
    return results.slice(0, 10); // Limit to 10 results
  } catch (error) {
    console.error('YouTube search error:', error.message);
    throw error;
  }
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

// YouTube Search endpoint with rate limiting protection and caching
app.get('/api/youtube/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Search query is required' });
  }
  
  try {
    // Check cache first
    const cachedResult = getCachedResult(q);
    if (cachedResult) {
      console.log(`Serving cached result for query: "${q}"`);
      return res.json(cachedResult);
    }
    
    // Check rate limits
    const rateLimitCheck = checkRateLimit();
    if (!rateLimitCheck.allowed) {
      const retryAfterSeconds = Math.ceil(rateLimitCheck.retryAfter / 1000);
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: retryAfterSeconds,
        type: 'rate_limit'
      });
    }
    
    // Perform search
    const searchResults = await performYouTubeSearch(q);
    
    const results = searchResults.map(item => ({
      videoId: item.id?.videoId || item.id,
      title: item.title,
      thumbnail: item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.url,
      channel: item.snippet?.channelTitle || 'Unknown',
      duration: item.duration_raw || item.snippet?.duration || 'Unknown',
      views: item.views || 'Unknown'
    }));
    
    // Cache the successful result
    setCachedResult(q, results);
    
    console.log(`Search completed for query: "${q}" - ${results.length} results`);
    res.json(results);
    
  } catch (error) {
    console.error('YouTube search error:', error);
    
    // Generic error - the new library is more reliable
    res.status(500).json({ 
      error: 'Failed to search YouTube. Please try again.',
      type: 'search_error'
    });
  }
});

// YouTube Playlist endpoint - currently not supported with youtube-search-without-api-key
app.get('/api/youtube/playlist', async (req, res) => {
  res.status(501).json({ 
    error: 'Playlist functionality is currently not supported. Please add songs individually by searching.',
    type: 'not_supported'
  });
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
