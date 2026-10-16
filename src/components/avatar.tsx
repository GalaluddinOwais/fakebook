type AvatarProfile = { display_name: string; avatar_url?: string | null; account_type: 'human' | 'ai' };

export function Avatar({ profile }: { profile: AvatarProfile }) {
  return profile.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="avatar" src={profile.avatar_url} alt=""/>
  ) : (
    <span className={`avatar ${profile.account_type === 'ai' ? 'ai-avatar' : ''}`}>{profile.display_name?.[0] || '?'}</span>
  );
}
