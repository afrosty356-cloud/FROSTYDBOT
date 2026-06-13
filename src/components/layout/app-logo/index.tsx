import { useDevice } from '@deriv-com/ui';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();

    if (!isDesktop) return null;
    return (
        <div className='app-header__logo'>
            <img
                src='/frostydbot-logo.jpeg'
                alt='FrostyDBot'
                className='app-header__logo-img'
            />
            <span className='app-header__logo-name'>
                {'FROSTYDBOT'.split('').map((char, i) => (
                    <span key={i} className='app-header__logo-name__char' style={{ animationDelay: `${i * 0.08}s` }}>
                        {char}
                    </span>
                ))}
            </span>
        </div>
    );
};
