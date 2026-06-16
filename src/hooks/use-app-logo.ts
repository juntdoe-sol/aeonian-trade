import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeAppSettings, type AppSettingsResponse } from '@/lib/collections/appSettings';

export function useAppLogo(): string | null {
  const { data } = useRealtimeData<AppSettingsResponse | null>(
    subscribeAppSettings,
    true,
    'logo'
  );
  return data?.value ?? null;
}
