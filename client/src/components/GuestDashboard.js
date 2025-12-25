import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { FiSearch, FiPlus, FiMusic, FiCheck, FiClock } from 'react-icons/fi';
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
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return AVG_SONG_DURATION;
}

// Format seconds to human readable ETA
function formatETA(seconds) {
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

  // Calculate ETA for a song at a given index
  const calculateETA = (index) => {
    let totalSeconds = 0;
    
    // Add remaining time for current song
    if (currentSong && currentSongStartedAt) {
      const elapsed = (Date.now() - currentSongStartedAt) / 1000;
      const currentDuration = parseDuration(currentSong.duration);
      const remaining = Math.max(0, currentDuration - elapsed);
      totalSeconds += remaining;
    } else if (currentSong) {
      // If no start time, assume half the song is left
      totalSeconds += parseDuration(currentSong.duration) / 2;
    }
    
    // Add duration of all songs before this one in queue
    for (let i = 0; i < index; i++) {
      totalSeconds += parseDuration(queue[i].duration);
    }
    
    return formatETA(totalSeconds);
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
          <p>Enter your name so the DJ knows who's requesting songs</p>
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
                          <FiClock /> {calculateETA(index)}
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
    </div>
  );
}

export default GuestDashboard;
