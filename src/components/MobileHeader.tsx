'use client';

import { Moon } from 'lucide-react';
import Link from 'next/link';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  return (
    <header className='glass-header md:hidden relative w-full'>
      <div className='h-16 flex items-center justify-between px-4'>
        {/* 左侧：返回按钮和设置按钮 */}
        <div className='flex items-center gap-2'>
          {showBackButton && <BackButton />}
        </div>

        {/* 右侧按钮 */}
        <div className='flex items-center gap-2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>

      {/* 中间：Logo（绝对居中） */}
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Link
          href='/'
          className='app-brand flex items-center gap-2 text-xl hover:opacity-80 transition-opacity'
        >
          <span className='brand-mark'>
            <Moon className='h-[18px] w-[18px]' strokeWidth={1.7} />
          </span>
          {siteName}
        </Link>
      </div>
    </header>
  );
};

export default MobileHeader;
