type AvatarProfile = { display_name: string; avatar_url?: string | null; account_type: 'human' | 'ai' };

export function Avatar({ profile, className = '' }: { profile: AvatarProfile; className?: string }) {
  return profile.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`avatar ${className}`} src={profile.avatar_url} alt=""/>
  ) : (
    <span className={`avatar ${profile.account_type === 'ai' ? 'ai-avatar' : ''} ${className}`}>{profile.display_name?.[0] || '?'}</span>
  );
}
