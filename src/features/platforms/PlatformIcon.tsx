import { useState } from 'react';
import { Globe } from 'lucide-react';

const iconModules = import.meta.glob('/src/assets/icons/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>;

function getIconUrl(id: string, name: string) {
  const normalizedId = id.toLowerCase();
  const normalizedName = name.toLowerCase();
  const searchTerms = [normalizedId, normalizedName];

  if (normalizedId.includes('chatgpt') || normalizedName.includes('chatgpt')) searchTerms.push('openai');
  if (normalizedId.includes('tongyi') || normalizedName.includes('tongyi')) searchTerms.push('qwen');
  if (normalizedName.includes('minimax') || normalizedId.includes('minimax')) searchTerms.push('minimax');

  for (const path in iconModules) {
    const filename = path.split('/').pop()?.toLowerCase() || '';
    if (searchTerms.some(term => filename.includes(term))) {
      return iconModules[path];
    }
  }

  return null;
}

interface PlatformIconProps {
  platformId: string;
  platformName: string;
  url?: string;
  size?: number;
}

function PlatformIcon({ platformId, platformName, url, size = 16 }: PlatformIconProps) {
  const [error, setError] = useState(false);
  const iconUrl = getIconUrl(platformId, platformName);

  if (!iconUrl || error) {
    if (url) {
      try {
        const domain = new URL(url).hostname;
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size * 2}`;
        return (
          <img
            src={faviconUrl}
            alt="favicon"
            width={size}
            height={size}
            className="platform-icon"
            onError={() => setError(true)}
          />
        );
      } catch {}
    }

    return <Globe size={size} />;
  }

  return (
    <img
      src={iconUrl}
      alt="icon"
      width={size}
      height={size}
      className="platform-icon"
      onError={() => setError(true)}
    />
  );
}

export default PlatformIcon;
