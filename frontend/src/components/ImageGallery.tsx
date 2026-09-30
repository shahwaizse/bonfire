import { useState } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';
import type { ImageResultItem } from '@/lib/types';

export default function ImageGallery({ images }: { images: ImageResultItem[] }) {
  return (
    <section aria-label="Image search results" className="mb-3 w-full min-w-0 max-w-full">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Pictures</span><span>{images.length} results</span>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map(image => <ImageCard key={image.url} image={image} />)}
      </div>
    </section>
  );
}

function ImageCard({ image }: { image: ImageResultItem }) {
  const [original, setOriginal] = useState(false);
  const [failed, setFailed] = useState(false);
  let domain = '';
  try { domain = new URL(image.source_url).hostname.replace(/^www\./, ''); } catch { /* Backend rejects invalid URLs. */ }
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border bg-card/80" data-testid="image-result">
      <a href={image.url} target="_blank" rel="noreferrer" aria-label={`Open image: ${image.title}`}
        className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-muted/50">
        {failed ? (
          <span className="flex flex-col items-center gap-2 px-2 text-center text-xs text-muted-foreground"><ImageOff className="size-5" />Preview unavailable</span>
        ) : (
          <img src={original ? image.url : image.thumbnail} alt={image.description || image.title} loading="lazy" decoding="async"
            referrerPolicy="no-referrer" className="h-full w-full object-contain transition-transform hover:scale-[1.03]"
            onError={() => { if (!original && image.thumbnail !== image.url) setOriginal(true); else setFailed(true); }} />
        )}
      </a>
      <figcaption className="space-y-1 px-2.5 py-2">
        <p className="truncate text-xs font-medium" title={image.title}>{image.title}</p>
        <a href={image.source_url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
          <span className="min-w-0 truncate">{domain || image.source || 'Source'}</span><ExternalLink className="size-3 flex-none" />
        </a>
      </figcaption>
    </figure>
  );
}
