// YouTube search using our backend API (which uses play-dl with rate limiting protection)

// Get the API base URL (works on mobile devices)
const getApiBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return '';
  }
  return `http://${window.location.hostname}:5000`;
};

// Retry function for handling temporary failures
const retryRequest = async (fn, maxRetries = 2, initialDelay = 2000) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      
      // Wait before retrying, with exponential backoff
      const delay = initialDelay * Math.pow(1.5, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Main search function - uses our backend endpoint with improved error handling
export const searchYouTube = async (query) => {
  try {
    const baseUrl = getApiBaseUrl();
    
    const searchRequest = async () => {
      const response = await fetch(`${baseUrl}/api/youtube/search?q=${encodeURIComponent(query)}`);
      
      if (!response.ok) {
        const error = await response.json();
        
        // Handle specific error types
        if (response.status === 429) {
          const retryAfter = error.retryAfter || 60;
          throw new Error(
            error.type === 'rate_limit' 
              ? `YouTube search is temporarily rate limited. Please wait ${retryAfter} seconds and try again.`
              : `Too many requests. Please wait ${retryAfter} seconds and try again.`
          );
        }
        
        if (response.status === 503) {
          throw new Error(error.error || 'YouTube search service is temporarily unavailable. Please try again.');
        }
        
        throw new Error(error.error || 'Search failed');
      }
      
      const results = await response.json();
      return results;
    };
    
    // Try the search with retries for network errors
    return await retryRequest(searchRequest);
    
  } catch (error) {
    console.error('YouTube search error:', error);
    
    // Provide user-friendly error messages
    if (error.message.includes('rate limit')) {
      throw new Error('YouTube search is temporarily limited. Please wait a moment and try again.');
    }
    
    if (error.message.includes('network') || error.message.includes('Failed to fetch')) {
      throw new Error('Connection issue. Please check your internet and try again.');
    }
    
    if (error.message.includes('unavailable')) {
      throw new Error('YouTube search is temporarily unavailable. Please try again in a few moments.');
    }
    
    throw error;
  }
};

export const formatDuration = (seconds) => {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
