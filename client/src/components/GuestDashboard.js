import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { FiSearch, FiPlus, FiMusic, FiCheck, FiClock, FiGithub, FiUnlock } from 'react-icons/fi';
import { searchYouTube } from '../utils/youtube';

// Use current hostname for socket connection (works on mobile)
const SOCKET_URL = process.env.NODE_ENV === 'production' 
  ? '' 
  : `http://${window.location.hostname}:5000`;

// Average song duration in seconds (3.5 minutes)
const AVG_SONG_DURATION = 210;

// Parse duration string like "3:45" to seconds
function parseDuration(durationStr) {
  if (!durationStr) return AVG_SONG_DURATION;
  const parts = durationStr.split(':').map(Number);
  
  // Check if any part is NaN
  if (parts.some(part => isNaN(part))) {
    return AVG_SONG_DURATION;
  }
  
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return AVG_SONG_DURATION;
}

// Format seconds to human readable ETA
function formatETA(seconds) {
  // Handle invalid input
  if (isNaN(seconds) || seconds < 0) {
    return '~ 0 min';
  }
  
  if (seconds < 60) return '< 1 min';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `~${hours}h ${remainingMins}m`;
}

function GuestDashboard() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSongStartedAt, setCurrentSongStartedAt] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [guestName, setGuestName] = useState('');
  const [showNameModal, setShowNameModal] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addedSongs, setAddedSongs] = useState(new Set());
  
  // Admin authentication state
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthLoading, setAdminAuthLoading] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState('');

  // Calculate ETA for a song at a given index
  const calculateETA = (index) => {
    let totalSeconds = 0;
    
    // Add remaining time for current song
    if (currentSong && currentSongStartedAt) {
      const startTime = typeof currentSongStartedAt === 'number' ? currentSongStartedAt : Date.parse(currentSongStartedAt);
      if (!isNaN(startTime)) {
        const elapsed = (Date.now() - startTime) / 1000;
        const currentDuration = parseDuration(currentSong.duration);
        const remaining = Math.max(0, currentDuration - elapsed);
        if (!isNaN(remaining)) {
          totalSeconds += remaining;
        }
      }
    } else if (currentSong) {
      // If no start time, assume half the song is left
      const halfDuration = parseDuration(currentSong.duration) / 2;
      if (!isNaN(halfDuration)) {
        totalSeconds += halfDuration;
      }
    }
    
    // Add duration of all songs before this one in queue
    for (let i = 0; i < index; i++) {
      if (queue[i] && queue[i].duration) {
        const duration = parseDuration(queue[i].duration);
        if (!isNaN(duration)) {
          totalSeconds += duration;
        }
      }
    }
    
    return formatETA(totalSeconds);
  };

  // Admin authentication
  const authenticateAsAdmin = async () => {
    setAdminAuthLoading(true);
    setAdminAuthError('');
    
    try {
      const response = await fetch(`/api/rooms/${roomId}/admin-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setAdminAuthError(data.error || 'Authentication failed');
        return;
      }
      
      // Store admin token and redirect to admin dashboard
      localStorage.setItem(`admin_${roomId}`, data.adminToken);
      navigate(`/admin/${roomId}`);
      
    } catch (err) {
      setAdminAuthError('Network error. Please try again.');
    } finally {
      setAdminAuthLoading(false);
    }
  };

  useEffect(() => {
    // Check for saved guest name
    const savedName = localStorage.getItem(`guest_name_${roomId}`);
    if (savedName) {
      setGuestName(savedName);
      setShowNameModal(false);
    }

    // Fetch room data
    fetch(`/api/rooms/${roomId}`)
      .then(res => {
        if (!res.ok) throw new Error('Room not found');
        return res.json();
      })
      .then(data => {
        setQueue(data.queue);
        setCurrentSong(data.currentSong);
        setIsPlaying(data.isPlaying);
        setCurrentSongStartedAt(data.currentSongStartedAt);
        setLoading(false);
      })
      .catch(err => {
        setError('Room not found. Please check the room code.');
        setLoading(false);
      });

    // Connect to socket
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.emit('join-room', roomId);

    newSocket.on('queue-updated', (newQueue) => {
      setQueue(newQueue);
    });

    newSocket.on('now-playing', (data) => {
      if (data && data.song !== undefined) {
        setCurrentSong(data.song);
        setCurrentSongStartedAt(data.startedAt || Date.now());
      } else {
        // Legacy format support
        setCurrentSong(data);
        setCurrentSongStartedAt(Date.now());
      }
    });

    newSocket.on('play-state-changed', (playing) => {
      setIsPlaying(playing);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [roomId]);

  const handleNameSubmit = (e) => {
    e.preventDefault();
    const name = guestName.trim() || 'Guest';
    setGuestName(name);
    localStorage.setItem(`guest_name_${roomId}`, name);
    setShowNameModal(false);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchError('');
    setSearchResults([]);

    try {
      const results = await searchYouTube(searchQuery);
      setSearchResults(results);
    } catch (err) {
      setSearchError(err.message || 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleAddSong = (video) => {
    if (addedSongs.has(video.videoId)) return;
    
    socket.emit('add-song', {
      roomId,
      song: {
        videoId: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail,
        channel: video.channel,
        duration: video.duration,
        addedBy: guestName
      }
    });
    
    setAddedSongs(prev => new Set([...prev, video.videoId]));
    
    // Reset after 3 seconds so they can add it again if needed
    setTimeout(() => {
      setAddedSongs(prev => {
        const next = new Set(prev);
        next.delete(video.videoId);
        return next;
      });
    }, 3000);
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-page">
        <h1>😕 Room Not Found</h1>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Go Home
        </button>
      </div>
    );
  }

  if (showNameModal) {
    return (
      <div className="modal-overlay">
        <div className="name-modal">
          <h2>👋 Welcome!</h2>
          <p>This app was developed for </p>
          <p style={{ color: '#22c55e' }}>27th December 2025 </p>
          <p>It is not intended for production or commercial use (yet)</p>
          <p>Built with ❤️ by <a href="https://github.com/stefan-ax" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', backgroundColor: '#333', color: '#fff', borderRadius: '0.375rem', textDecoration: 'none', fontSize: '0.875rem', marginLeft: '0.25rem' }}><FiGithub /> stefan-ax</a></p>
          
          <form onSubmit={handleNameSubmit}>
            <div className="input-group">
              <input
                type="text"
                className="input"
                placeholder="Your name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              Join Party 🎉
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <Link to="/" className="dashboard-logo">
          🎵 <span>GuestDJ</span>
        </Link>
        <div className="room-info">
          <span className="room-id">{guestName}</span>
          <button 
            className="btn btn-link" 
            onClick={() => setShowAdminModal(true)}
            style={{ 
              fontSize: '0.8rem', 
              padding: '0.25rem 0.5rem', 
              marginLeft: '0.5rem',
              color: 'var(--text-secondary)',
              background: 'var(--bg-tertiary)',
              textDecoration: 'none'
            }}
            title="Sign in as admin"
          >
            Guest Mode
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="guest-dashboard">
          {/* Search Section */}
          <div className="search-section">
            <h2><FiSearch style={{ marginRight: '0.5rem' }} /> Search Songs</h2>
            <form className="search-form" onSubmit={handleSearch}>
              <input
                type="text"
                className="input"
                placeholder="Search for songs on YouTube..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={searching}>
                {searching ? '...' : <FiSearch size={20} />}
              </button>
            </form>

            {searchError && (
              <div className="search-empty" style={{ color: '#ef4444' }}>
                {searchError}
              </div>
            )}

            {searching && (
              <div className="search-loading">
                <div className="spinner"></div>
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((video) => (
                  <div key={video.videoId} className="search-result-item">
                    <img src={video.thumbnail} alt="" className="song-thumbnail" />
                    <div className="song-info">
                      <div className="song-title">{video.title}</div>
                      <div className="song-meta">
                        <span>{video.channel}</span>
                        {video.duration && <span>• {video.duration}</span>}
                      </div>
                    </div>
                    <button 
                      className={`btn btn-icon ${addedSongs.has(video.videoId) ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => handleAddSong(video)}
                      disabled={addedSongs.has(video.videoId)}
                    >
                      {addedSongs.has(video.videoId) ? <FiCheck size={18} /> : <FiPlus size={18} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Now Playing */}
          <div className="current-playing">
            <h2>
              {isPlaying && (
                <div className="playing-indicator" style={{ marginRight: '0.5rem' }}>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}
              Now Playing
            </h2>
            {currentSong ? (
              <div className="current-song-display">
                <img src={currentSong.thumbnail} alt="" className="current-song-thumbnail" />
                <div className="song-info">
                  <div className="song-title">{currentSong.title}</div>
                  <div className="song-meta">
                    <span>Requested by {currentSong.addedBy}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="no-song">
                <FiMusic size={24} style={{ marginBottom: '0.5rem' }} />
                <p>No song playing right now</p>
              </div>
            )}
          </div>

          {/* Queue */}
          <div className="guest-queue">
            <div className="guest-queue-header">
              <h2>
                <FiMusic style={{ marginRight: '0.5rem' }} />
                Up Next
                <span className="queue-count">{queue.length}</span>
              </h2>
            </div>
            <div className="guest-queue-list">
              {queue.length === 0 ? (
                <div className="queue-empty">
                  <p>Queue is empty</p>
                  <p style={{ fontSize: '0.875rem' }}>Search and add some songs!</p>
                </div>
              ) : (
                queue.map((song, index) => (
                  <div key={song.id} className="guest-song-item">
                    <span className="queue-position">{index + 1}</span>
                    <img src={song.thumbnail} alt="" className="song-thumbnail" />
                    <div className="song-info">
                      <div className="song-title">{song.title}</div>
                      <div className="song-meta">
                        <span>Added by {song.addedBy}</span>
                        <span className="eta-badge">
                          <FiClock /> Coming in {calculateETA(index)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Admin Authentication Modal */}
      {showAdminModal && (
        <div className="modal-overlay" onClick={() => setShowAdminModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>🔐 Admin Sign In</h2>
            <p>Enter the room password to access admin controls</p>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              authenticateAsAdmin();
            }}>
              <div className="input-group">
                <input
                  type="password"
                  className="input"
                  placeholder="Room password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  autoFocus
                />
              </div>
              
              {adminAuthError && (
                <p style={{ color: '#ef4444', fontSize: '0.875rem', margin: '0.5rem 0' }}>
                  {adminAuthError}
                </p>
              )}
              
              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setShowAdminModal(false);
                    setAdminPassword('');
                    setAdminAuthError('');
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={adminAuthLoading || !adminPassword.trim()}
                >
                  {adminAuthLoading ? 'Signing In...' : 'Sign In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default GuestDashboard;
