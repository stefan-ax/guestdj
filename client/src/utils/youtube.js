// YouTube search using our backend API (which uses play-dl - no API key needed)

// Get the API base URL (works on mobile devices)
const getApiBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return '';
  }
  return `http://${window.location.hostname}:5000`;
};

// Main search function - uses our backend endpoint
export const searchYouTube = async (query) => {
  try {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/youtube/search?q=${encodeURIComponent(query)}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Search failed');
    }
    
    const results = await response.json();
    return results;
  } catch (error) {
    console.error('YouTube search error:', error);
    throw error;
  }
};

export const formatDuration = (seconds) => {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
