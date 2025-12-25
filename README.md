# 🎵 GuestDJ - Party Song Queue

Let your party guests be the DJ! Create a virtual room, share the link, and let your friends request songs that play through YouTube.

![GuestDJ Screenshot](https://via.placeholder.com/800x400?text=GuestDJ+Party+Queue)

## Features

### For Hosts (Admin)
- 🎛️ **Create rooms** - Generate a unique room code instantly
- 🎵 **YouTube playback** - Songs play directly through YouTube
- 📋 **Queue management** - Drag to reorder, click to play, or remove songs
- ⏭️ **Playback controls** - Play, pause, skip songs
- 🔗 **Easy sharing** - Share room link with one click

### For Guests
- 🔍 **YouTube search** - Find any song on YouTube
- ➕ **Add to queue** - Request songs with one tap
- 👀 **See the queue** - View what's playing and coming up next
- 📱 **Mobile friendly** - Works great on phones

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Local Development

1. **Clone and install dependencies:**
```bash
git clone <your-repo-url>
cd guestdj
npm run install:all
```

2. **Start development servers:**
```bash
npm run dev
```

This starts:
- Backend server on http://localhost:5000
- React dev server on http://localhost:3000

3. **Open http://localhost:3000** in your browser

### Production Deployment

#### Using Docker (Recommended)

1. **Build and run with Docker Compose:**
```bash
docker-compose up -d
```

2. **Or build manually:**
```bash
docker build -t guestdj .
docker run -p 5000:5000 guestdj
```

The app will be available at http://localhost:5000

#### Manual Deployment

1. **Build the React client:**
```bash
npm run build
```

2. **Start the production server:**
```bash
NODE_ENV=production npm start
```

## How It Works

### Creating a Room (Host)
1. Go to the home page
2. Enter your name (optional)
3. Click "Create Room"
4. Share the room link with your guests
5. Control playback from the admin dashboard

### Joining a Room (Guest)
1. Open the shared link or enter the room code
2. Enter your name
3. Search for songs on YouTube
4. Tap + to add songs to the queue
5. Watch the queue update in real-time

## Tech Stack

- **Frontend:** React 18, React Router, Socket.IO Client, @dnd-kit (drag and drop)
- **Backend:** Node.js, Express, Socket.IO
- **Styling:** Custom CSS (responsive design)
- **Video:** YouTube IFrame API
- **Search:** Invidious API (no YouTube API key needed!)

## Project Structure

```
guestdj/
├── server/
│   └── index.js          # Express + Socket.IO server
├── client/
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.js
│       ├── index.js
│       ├── index.css
│       └── components/
│           ├── Home.js           # Landing page
│           ├── AdminDashboard.js # Host control panel
│           └── GuestDashboard.js # Guest interface
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Configuration

Environment variables:
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment (development/production)

## Limitations

- Rooms are stored in memory (restart clears all rooms)
- No persistent storage for queues
- YouTube search uses Invidious API (may have rate limits)

## Future Improvements

- Redis/MongoDB for persistent rooms
- User authentication
- Vote to skip songs
- Chat feature
- Playlist import
- Queue history

## License

MIT

---

Made with ❤️ for party people 🎉
