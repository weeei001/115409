import { useRouter } from 'next/router';
import { Star } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { getToken } from '@/lib/auth/storage';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { cn } from '@/lib/cn';

/** 個股頁標題旁的收藏星號：已登入就樂觀切換，未登入帶 returnUrl 導到登入頁 */
export function FavoriteToggle({ symbol }: { symbol: string }) {
  const router = useRouter();
  const favorites = useFavorites();
  const pressed = favorites.isFavorite(symbol);
  const busy = favorites.isPending(symbol) || favorites.status === 'idle' || favorites.status === 'loading';

  const handlePressedChange = () => {
    if (!getToken()) {
      const returnUrl = safeReturnUrl(router.asPath) ?? `/stock/${symbol}`;
      void router.push({ pathname: '/login', query: { returnUrl } });
      return;
    }
    favorites.toggle(symbol);
  };

  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={handlePressedChange}
      aria-label={pressed ? '取消收藏' : '加入收藏'}
      aria-busy={busy || undefined}
      className="size-11 shrink-0 text-muted-foreground hover:text-foreground data-[state=on]:text-foreground [&_svg:not([class*='size-'])]:size-5"
    >
      {/* 已收藏：實心星；圖示用文字色，不用燈色（燈只當光用） */}
      <Star className={cn(pressed && 'fill-current')} aria-hidden />
    </Toggle>
  );
}
