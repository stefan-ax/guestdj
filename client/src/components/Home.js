import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMusic, FiPlus, FiUsers } from 'react-icons/fi';

function Home() {
  const navigate = useNavigate();
  const [hostName, setHostName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const createRoom = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          hostName: hostName || 'DJ',
          password: roomPassword || null
        })
      });
      
      const data = await response.json();
      
      // Store admin token in localStorage
      localStorage.setItem(`admin_${data.roomId}`, data.adminToken);
      
      navigate(`/admin/${data.roomId}`);
    } catch (err) {
      setError('Failed to create room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = () => {
    if (roomCode.trim()) {
      navigate(`/room/${roomCode.trim()}`);
    }
  };

  return (
    <div className="home">
      <div className="home-logo">🎵</div>
      <h1>GuestDJ</h1>
      <p className="home-subtitle">Let your guests be the DJ</p>
      
      <div className="home-actions">
        <div className="home-card">
          <h2><FiPlus style={{ marginRight: '0.5rem' }} /> Create a Room</h2>
          <p>Start a new party queue and share it with your guests</p>
          
          <div className="input-group">
            <label>Your Name (optional)</label>
            <input
              type="text"
              className="input"
              placeholder="DJ Awesome"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
            />
          </div>
          
          <div className="input-group">
            <label>Room Password (optional)</label>
            <input
              type="password"
              className="input"
              placeholder="Set a password for admin access"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
            />
          </div>
          
          <button 
            className="btn btn-primary" 
            onClick={createRoom}
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Creating...' : 'Create Room'}
          </button>
          
          {error && <p style={{ color: '#ef4444', marginTop: '0.5rem', fontSize: '0.875rem' }}>{error}</p>}
        </div>
        
        <div className="home-card">
          <h2><FiUsers style={{ marginRight: '0.5rem' }} /> Join a Room</h2>
          <p>Enter the room code to add songs to the queue</p>
          
          <div className="input-group">
            <label>Room Code</label>
            <input
              type="text"
              className="input"
              placeholder="Enter room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            />
          </div>
          
          <button 
            className="btn btn-secondary" 
            onClick={joinRoom}
            disabled={!roomCode.trim()}
            style={{ width: '100%' }}
          >
            Join Room
          </button>
        </div>
      </div>
      
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '3rem' }}>
        <FiMusic style={{ marginRight: '0.5rem' }} />
        Search YouTube and build your party playlist together
      </p>
    </div>
  );
}

export default Home;
