import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { FiPlay, FiPause, FiSkipForward, FiShare2, FiTrash2, FiMenu, FiMusic, FiCopy, FiX, FiSearch, FiPlus, FiCheck, FiList, FiLink } from 'react-icons/fi';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { QRCodeSVG } from 'qrcode.react';
import { searchYouTube } from '../utils/youtube';

const SOCKET_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000';

function SortableSongItem({ song, onRemove, onPlay, isFallback }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: song.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={`song-item ${isFallback ? 'song-item-fallback' : ''}`}>
      <div className="song-drag-handle" {...attributes} {...listeners}>
        <FiMenu />
      </div>
      <img 
        src={song.thumbnail} 
        alt="" 
        className="song-thumbnail"
        onClick={() => onPlay(song)}
        style={{ cursor: 'pointer' }}
      />
      <div className="song-info" onClick={() => onPlay(song)} style={{ cursor: 'pointer' }}>
        <div className="song-title">{song.title}</div>
        <div className="song-meta">
          <span>{isFallback ? `${song.channel || 'Fallback'}` : `Added by ${song.addedBy}`}</span>
        </div>
      </div>
      <div className="song-actions">
        <button className="btn btn-icon btn-danger" onClick={() => onRemove(song.id)}>
          <FiTrash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayingFallback, setIsPlayingFallback] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showFallbackModal, setShowFallbackModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hostName, setHostName] = useState('DJ');
  
  // Fallback playlist
  const [fallbackPlaylist, setFallbackPlaylist] = useState([]);
  const [fallbackSearchQuery, setFallbackSearchQuery] = useState('');
  const [fallbackSearchResults, setFallbackSearchResults] = useState([]);
  const [fallbackSearching, setFallbackSearching] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState('');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [addedSongs, setAddedSongs] = useState(new Set());
  const [addedToFallback, setAddedToFallback] = useState(new Set());
  
  const playerRef = useRef(null);
  const adminToken = localStorage.getItem(`admin_${roomId}`);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!adminToken) {
      setError('Access denied. You are not the admin of this room.');
      setLoading(false);
      return;
    }

    // Verify admin access
    fetch(`/api/rooms/${roomId}/admin`, {
      headers: { 'x-admin-token': adminToken }
    })
      .then(res => {
        if (!res.ok) throw new Error('Invalid admin token');
        return res.json();
      })
      .then(data => {
        setQueue(data.queue);
        setCurrentSong(data.currentSong);
        setIsPlaying(data.isPlaying);
        setHostName(data.hostName || 'DJ');
        setFallbackPlaylist(data.fallbackPlaylist || []);
        setLoading(false);
      })
      .catch(err => {
        setError('Room not found or access denied.');
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
        setIsPlayingFallback(data.isPlayingFallback || false);
      } else {
        // Legacy format support
        setCurrentSong(data);
        setIsPlayingFallback(false);
      }
    });

    newSocket.on('play-state-changed', (playing) => {
      setIsPlaying(playing);
    });
    
    newSocket.on('fallback-updated', (playlist) => {
      setFallbackPlaylist(playlist);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [roomId, adminToken]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }, []);

  const onPlayerStateChange = useCallback((event) => {
    // Video ended
    if (event.data === 0) {
      if (socket && adminToken) {
        socket.emit('song-ended', { roomId, adminToken });
      }
    }
    // Video playing
    if (event.data === 1) {
      setIsPlaying(true);
    }
    // Video paused
    if (event.data === 2) {
      setIsPlaying(false);
    }
  }, [socket, roomId, adminToken]);

  // Initialize YouTube player when current song changes
  useEffect(() => {
    if (!currentSong) return;

    const initPlayer = () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }

      playerRef.current = new window.YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: currentSong.videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0
        },
        events: {
          onStateChange: onPlayerStateChange
        }
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }
  }, [currentSong, onPlayerStateChange]);

  const handlePlayPause = () => {
    if (playerRef.current) {
      if (isPlaying) {
        playerRef.current.pauseVideo();
      } else {
        playerRef.current.playVideo();
      }
      socket.emit('toggle-play', { roomId, isPlaying: !isPlaying, adminToken });
    }
  };

  const handleSkip = () => {
    socket.emit('skip-song', { roomId, adminToken });
  };

  const handlePlayNow = (song) => {
    // Remove from queue and set as current
    const newQueue = queue.filter(s => s.id !== song.id);
    socket.emit('reorder-queue', { roomId, queue: newQueue, adminToken });
    socket.emit('set-current-song', { roomId, song, adminToken });
  };

  const handleRemove = (songId) => {
    socket.emit('remove-song', { roomId, songId, adminToken });
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    
    if (active.id !== over.id) {
      const oldIndex = queue.findIndex(s => s.id === active.id);
      const newIndex = queue.findIndex(s => s.id === over.id);
      const newQueue = arrayMove(queue, oldIndex, newIndex);
      setQueue(newQueue);
      socket.emit('reorder-queue', { roomId, queue: newQueue, adminToken });
    }
  };

  const handleFallbackDragEnd = (event) => {
    const { active, over } = event;
    
    if (active.id !== over.id) {
      const oldIndex = fallbackPlaylist.findIndex(s => s.id === active.id);
      const newIndex = fallbackPlaylist.findIndex(s => s.id === over.id);
      const newPlaylist = arrayMove(fallbackPlaylist, oldIndex, newIndex);
      setFallbackPlaylist(newPlaylist);
      socket.emit('reorder-fallback', { roomId, playlist: newPlaylist, adminToken });
    }
  };

  const handlePlayFromFallback = (song) => {
    socket.emit('set-current-song', { roomId, song: { ...song, addedBy: 'Fallback' }, adminToken });
  };

  const handlePlayNext = () => {
    socket.emit('play-next', { roomId, adminToken });
  };

  const copyShareLink = () => {
    const shareUrl = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Fallback playlist functions
  const handleFallbackSearch = async (e) => {
    e.preventDefault();
    if (!fallbackSearchQuery.trim()) return;

    setFallbackSearching(true);
    setFallbackSearchResults([]);

    try {
      const results = await searchYouTube(fallbackSearchQuery);
      setFallbackSearchResults(results);
    } catch (err) {
      console.error('Fallback search failed:', err);
    } finally {
      setFallbackSearching(false);
    }
  };

  const handleAddToFallback = (video) => {
    if (addedToFallback.has(video.videoId)) return;
    
    socket.emit('add-to-fallback', {
      roomId,
      song: {
        videoId: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail,
        channel: video.channel,
        duration: video.duration
      },
      adminToken
    });
    
    setAddedToFallback(prev => new Set([...prev, video.videoId]));
    
    setTimeout(() => {
      setAddedToFallback(prev => {
        const next = new Set(prev);
        next.delete(video.videoId);
        return next;
      });
    }, 3000);
  };

  const handleRemoveFromFallback = (songId) => {
    socket.emit('remove-from-fallback', { roomId, songId, adminToken });
  };

  const handleImportPlaylist = async (e) => {
    e.preventDefault();
    if (!playlistUrl.trim()) return;

    setPlaylistLoading(true);
    setPlaylistError('');

    try {
      const response = await fetch(`/api/youtube/playlist?url=${encodeURIComponent(playlistUrl)}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch playlist');
      }
      
      // Add all videos to fallback playlist
      for (const video of data.videos) {
        socket.emit('add-to-fallback', {
          roomId,
          song: {
            videoId: video.videoId,
            title: video.title,
            thumbnail: video.thumbnail,
            channel: video.channel,
            duration: video.duration
          },
          adminToken
        });
      }
      
      setPlaylistUrl('');
      setPlaylistError(`✓ Added ${data.videos.length} songs from "${data.title}"`);
      setTimeout(() => setPlaylistError(''), 5000);
    } catch (err) {
      setPlaylistError(err.message || 'Failed to import playlist');
    } finally {
      setPlaylistLoading(false);
    }
  };

  // Search functionality
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
        addedBy: hostName
      }
    });
    
    setAddedSongs(prev => new Set([...prev, video.videoId]));
    
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
        <h1>😕 Oops!</h1>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Go Home
        </button>
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
          <span className="room-id">Room: {roomId}</span>
          <button className="btn btn-secondary btn-icon" onClick={() => setShowFallbackModal(true)} title="Fallback Playlist">
            <FiList size={18} />
          </button>
          <button className="btn btn-secondary btn-icon" onClick={() => setShowShareModal(true)} title="Share Room">
            <FiShare2 size={18} />
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="admin-dashboard">
          <div className="admin-main">
            {/* Player Section */}
            <div className="player-section">
              <div className="player-container">
                {currentSong ? (
                  <div id="youtube-player"></div>
                ) : (
                  <div className="player-placeholder">
                    <FiMusic size={64} />
                    <p>No song playing</p>
                    {(queue.length > 0 || fallbackPlaylist.length > 0) && (
                      <button className="btn btn-primary" onClick={handlePlayNext}>
                        {queue.length > 0 ? 'Play Next in Queue' : 'Play Fallback'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              
              {currentSong && (
                <>
                  <div className="player-controls">
                    <button className="btn btn-secondary btn-icon" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
                      {isPlaying ? <FiPause size={24} /> : <FiPlay size={24} />}
                    </button>
                    <button className="btn btn-secondary btn-icon" onClick={handleSkip} title="Skip to next">
                      <FiSkipForward size={24} />
                    </button>
                  </div>
                  <div className="now-playing-info">
                    <p className="now-playing-label">
                      {isPlayingFallback ? '🎵 Fallback Playing' : 'Now Playing'}
                    </p>
                    <p className="now-playing-title">{currentSong.title}</p>
                  </div>
                </>
              )}
            </div>

            {/* Admin Search Section */}
            <div className="search-section admin-search">
              <h2><FiSearch style={{ marginRight: '0.5rem' }} /> Add Songs</h2>
              <form className="search-form" onSubmit={handleSearch}>
                <input
                  type="text"
                  className="input"
                  placeholder="Search YouTube for songs..."
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
                        title="Add to queue"
                      >
                        {addedSongs.has(video.videoId) ? <FiCheck size={18} /> : <FiPlus size={18} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Queue Section */}
          <div className="queue-section">
            <div className="queue-header">
              <h2>
                Guest Queue
                <span className="queue-count">{queue.length}</span>
              </h2>
            </div>
            
            <div className="queue-list">
              {queue.length === 0 ? (
                <div className="queue-empty-small">
                  <p>No guest requests yet</p>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={queue.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {queue.map((song) => (
                      <SortableSongItem
                        key={song.id}
                        song={song}
                        onRemove={handleRemove}
                        onPlay={handlePlayNow}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* Fallback Playlist Section */}
            <div className="queue-header" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <div>
                <h2>
                  <span style={{ color: 'var(--warning)' }}>🎵</span> Fallback
                  <span className="queue-count">{fallbackPlaylist.length}</span>
                </h2>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Plays in order • Drag to reorder
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowFallbackModal(true)}>
                <FiPlus size={14} /> Add
              </button>
            </div>
            
            <div className="queue-list">
              {fallbackPlaylist.length === 0 ? (
                <div className="queue-empty-small">
                  <p>No fallback songs</p>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowFallbackModal(true)} style={{ marginTop: '0.5rem' }}>
                    Add fallback playlist
                  </button>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleFallbackDragEnd}
                >
                  <SortableContext items={fallbackPlaylist.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {fallbackPlaylist.map((song) => (
                      <SortableSongItem
                        key={song.id}
                        song={song}
                        onRemove={handleRemoveFromFallback}
                        onPlay={handlePlayFromFallback}
                        isFallback={true}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      </div>

      {showShareModal && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2>Share Room</h2>
                <p>Share this link with your guests so they can add songs!</p>
              </div>
              <button className="btn btn-icon btn-secondary" onClick={() => setShowShareModal(false)}>
                <FiX size={18} />
              </button>
            </div>
            
            {/* QR Code */}
            <div className="qr-code-container">
              <QRCodeSVG 
                value={`${window.location.origin}/room/${roomId}`}
                size={200}
                bgColor="#121212"
                fgColor="#00ff88"
                level="M"
                includeMargin={true}
              />
            </div>
            
            <div className="share-link">
              <input
                type="text"
                className="input"
                value={`${window.location.origin}/room/${roomId}`}
                readOnly
              />
              <button className="btn btn-primary" onClick={copyShareLink}>
                <FiCopy size={18} />
              </button>
            </div>
            
            {copied && (
              <div className="copied-toast">
                ✓ Copied to clipboard!
              </div>
            )}
            
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: '12px' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                <strong>Room Code:</strong> {roomId}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Guests can scan the QR code or enter this code on the home page
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fallback Playlist Modal */}
      {showFallbackModal && (
        <div className="modal-overlay" onClick={() => setShowFallbackModal(false)}>
          <div className="modal modal-large" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h2>🎵 Fallback Playlist</h2>
                <p>These songs play automatically when the guest queue is empty</p>
              </div>
              <button className="btn btn-icon btn-secondary" onClick={() => setShowFallbackModal(false)}>
                <FiX size={18} />
              </button>
            </div>
            
            {/* Search for fallback */}
            <form className="search-form" onSubmit={handleFallbackSearch} style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                className="input"
                placeholder="Search songs to add to fallback..."
                value={fallbackSearchQuery}
                onChange={(e) => setFallbackSearchQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={fallbackSearching}>
                {fallbackSearching ? '...' : <FiSearch size={20} />}
              </button>
            </form>

            {fallbackSearchResults.length > 0 && (
              <div className="search-results" style={{ maxHeight: '200px', marginBottom: '1rem' }}>
                {fallbackSearchResults.map((video) => (
                  <div key={video.videoId} className="search-result-item">
                    <img src={video.thumbnail} alt="" className="song-thumbnail" />
                    <div className="song-info">
                      <div className="song-title">{video.title}</div>
                      <div className="song-meta">{video.channel}</div>
                    </div>
                    <button 
                      className={`btn btn-icon ${addedToFallback.has(video.videoId) ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => handleAddToFallback(video)}
                      disabled={addedToFallback.has(video.videoId)}
                    >
                      {addedToFallback.has(video.videoId) ? <FiCheck size={18} /> : <FiPlus size={18} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Import YouTube Playlist */}
            <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FiLink size={16} /> Import YouTube Playlist
              </h3>
              <form className="search-form" onSubmit={handleImportPlaylist}>
                <input
                  type="text"
                  className="input"
                  placeholder="Paste YouTube playlist URL..."
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={playlistLoading}>
                  {playlistLoading ? '...' : <FiPlus size={20} />}
                </button>
              </form>
              {playlistError && (
                <p style={{ 
                  fontSize: '0.75rem', 
                  marginTop: '0.5rem',
                  color: playlistError.startsWith('✓') ? 'var(--accent-primary)' : '#ef4444'
                }}>
                  {playlistError}
                </p>
              )}
            </div>
            
            {/* Current fallback playlist */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
                Playlist ({fallbackPlaylist.length} songs)
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                📋 Songs play in order from top to bottom. Drag to reorder.
              </p>
              {fallbackPlaylist.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
                  No fallback songs yet. Search above or import a playlist!
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleFallbackDragEnd}
                >
                  <SortableContext items={fallbackPlaylist.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="fallback-list">
                      {fallbackPlaylist.map((song) => (
                        <SortableSongItem
                          key={song.id}
                          song={song}
                          onRemove={handleRemoveFromFallback}
                          onPlay={handlePlayFromFallback}
                          isFallback={true}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
