import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAppId, getSocketURL } from '@/components/shared/utils/config/config';
import './ai-scanner.scss';

type Strategy = 'over1_under8' | 'over2_under7' | 'even_odd' | 'matches_differs';

interface ScanResult {
    market: string;
    marketName: string;
    tradeType: string;
    winRate: number;
}

const MARKETS = [
    { symbol: '1HZ10V', name: 'Volatility 10 (1s)', pipSize: 3 },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s)', pipSize: 3 },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s)', pipSize: 4 },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s)', pipSize: 4 },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s)', pipSize: 2 },
    { symbol: 'R_10', name: 'Volatility 10 Index', pipSize: 3 },
    { symbol: 'R_25', name: 'Volatility 25 Index', pipSize: 3 },
    { symbol: 'R_50', name: 'Volatility 50 Index', pipSize: 4 },
    { symbol: 'R_75', name: 'Volatility 75 Index', pipSize: 4 },
    { symbol: 'R_100', name: 'Volatility 100 Index', pipSize: 2 },
];

const STRATEGIES: { key: Strategy; label: string; description: string }[] = [
    {
        key: 'over1_under8',
        label: 'Over1 / Under8',
        description: 'Scans Over 1 and Under 8 digit patterns with recovery confirmation.',
    },
    {
        key: 'over2_under7',
        label: 'Over2 / Under7',
        description: 'Scans Over 2 and Under 7 digit patterns with recovery confirmation.',
    },
    {
        key: 'even_odd',
        label: 'Even / Odd',
        description: 'Scans Even and Odd last-digit patterns across Volatility markets.',
    },
    {
        key: 'matches_differs',
        label: 'Matches / Differs',
        description: 'Finds the best digit for Matches or Differs contract entry.',
    },
];

const getLastDigit = (price: number, pipSize: number): number => {
    const fixed = price.toFixed(pipSize);
    return parseInt(fixed[fixed.length - 1], 10);
};

const analyzeDigits = (
    digits: number[],
    strategy: Strategy
): { tradeType: string; winRate: number } => {
    if (!digits.length) return { tradeType: 'N/A', winRate: 0 };

    switch (strategy) {
        case 'over1_under8': {
            const over1 = (digits.filter(d => d > 1).length / digits.length) * 100;
            const under8 = (digits.filter(d => d < 8).length / digits.length) * 100;
            return over1 >= under8
                ? { tradeType: 'Over 1', winRate: over1 }
                : { tradeType: 'Under 8', winRate: under8 };
        }
        case 'over2_under7': {
            const over2 = (digits.filter(d => d > 2).length / digits.length) * 100;
            const under7 = (digits.filter(d => d < 7).length / digits.length) * 100;
            return over2 >= under7
                ? { tradeType: 'Over 2', winRate: over2 }
                : { tradeType: 'Under 7', winRate: under7 };
        }
        case 'even_odd': {
            const even = (digits.filter(d => d % 2 === 0).length / digits.length) * 100;
            const odd = 100 - even;
            return even >= odd ? { tradeType: 'Even', winRate: even } : { tradeType: 'Odd', winRate: odd };
        }
        case 'matches_differs': {
            const counts = new Array(10).fill(0);
            digits.forEach(d => counts[d]++);
            const minIdx = counts.indexOf(Math.min(...counts));
            const maxIdx = counts.indexOf(Math.max(...counts));
            const differsRate = ((digits.length - counts[minIdx]) / digits.length) * 100;
            const matchesRate = (counts[maxIdx] / digits.length) * 100;
            return differsRate >= matchesRate
                ? { tradeType: `Differs ${minIdx}`, winRate: differsRate }
                : { tradeType: `Matches ${maxIdx}`, winRate: matchesRate };
        }
    }
};

const fetchTickDigits = (symbol: string, pipSize: number, count: number): Promise<number[]> =>
    new Promise((resolve, reject) => {
        const appId = getAppId();
        const server = getSocketURL().replace(/[^a-zA-Z0-9.]/g, '');
        const ws = new WebSocket(
            `wss://${server}/websockets/v3?app_id=${appId}&l=EN&brand=frostydbot`
        );

        const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`Timeout: ${symbol}`));
        }, 20000);

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    ticks_history: symbol,
                    count: Math.min(count, 5000),
                    end: 'latest',
                    style: 'ticks',
                })
            );
        };

        ws.onmessage = e => {
            clearTimeout(timer);
            try {
                const data = JSON.parse(e.data);
                ws.close();
                if (data.error) {
                    reject(new Error(data.error.message));
                    return;
                }
                if (data.history?.prices) {
                    resolve(data.history.prices.map((p: number) => getLastDigit(p, pipSize)));
                } else {
                    reject(new Error('No price data'));
                }
            } catch {
                reject(new Error('Parse error'));
            }
        };

        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`WS error: ${symbol}`));
        };
    });

const SparkleIcon = () => (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path
            d='M12 2L13.9 9.1L21 7L15.5 12L21 17L13.9 14.9L12 22L10.1 14.9L3 17L8.5 12L3 7L10.1 9.1L12 2Z'
            fill='currentColor'
        />
    </svg>
);

const AIScanner: React.FC = () => {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [strategy, setStrategy] = useState<Strategy>('over1_under8');
    const [ticks, setTicks] = useState(1000);
    const [isScanning, setIsScanning] = useState(false);
    const [result, setResult] = useState<ScanResult | null>(null);
    const [statusMsg, setStatusMsg] = useState('');
    const [progress, setProgress] = useState(0);
    const abortRef = useRef(false);

    const handleClose = () => {
        abortRef.current = true;
        setIsOpen(false);
    };

    const handleStrategyChange = (s: Strategy) => {
        if (isScanning) return;
        setStrategy(s);
        setResult(null);
        setStatusMsg('');
        setProgress(0);
    };

    const handleScan = useCallback(async () => {
        if (isScanning) return;
        abortRef.current = false;
        setIsScanning(true);
        setResult(null);
        setProgress(0);
        setStatusMsg('Initializing scan...');

        const results: ScanResult[] = [];

        for (let i = 0; i < MARKETS.length; i++) {
            if (abortRef.current) break;
            const { symbol, name, pipSize } = MARKETS[i];
            setStatusMsg(`Scanning ${name}...`);
            setProgress(Math.round(((i + 0.5) / MARKETS.length) * 100));
            try {
                const digits = await fetchTickDigits(symbol, pipSize, ticks);
                if (abortRef.current) break;
                const { tradeType, winRate } = analyzeDigits(digits, strategy);
                results.push({ market: symbol, marketName: name, tradeType, winRate });
            } catch {
                // skip market on error
            }
        }

        if (!abortRef.current && results.length > 0) {
            const best = results.reduce((a, b) => (a.winRate > b.winRate ? a : b));
            setResult(best);
            setStatusMsg(`Best market: ${best.marketName} — ${best.tradeType} (${best.winRate.toFixed(1)}%)`);
            setProgress(100);
        } else if (!abortRef.current) {
            setStatusMsg('Scan failed. Check your connection.');
        }

        setIsScanning(false);
    }, [isScanning, strategy, ticks]);

    const handleLoadBot = () => {
        handleClose();
        navigate('/');
    };

    const readyLabel = STRATEGIES.find(s => s.key === strategy)?.label ?? '';

    return (
        <>
            <button
                className='ai-scanner__fab'
                onClick={() => setIsOpen(true)}
                title='AI Market Scanner'
                aria-label='Open AI Market Scanner'
            >
                <SparkleIcon />
                <span>AI</span>
            </button>

            {isOpen && (
                <div
                    className='ai-scanner__overlay'
                    onClick={e => {
                        if (e.target === e.currentTarget) handleClose();
                    }}
                >
                    <div className='ai-scanner__modal'>
                        <div className='ai-scanner__header'>
                            <span className='ai-scanner__title'>Entry Scanner</span>
                            <button
                                className='ai-scanner__close'
                                onClick={handleClose}
                                aria-label='Close'
                            >
                                ✕
                            </button>
                        </div>

                        <div className='ai-scanner__tabs'>
                            {STRATEGIES.map(s => (
                                <button
                                    key={s.key}
                                    className={`ai-scanner__tab${strategy === s.key ? ' ai-scanner__tab--active' : ''}`}
                                    onClick={() => handleStrategyChange(s.key)}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>

                        <div className='ai-scanner__body'>
                            <div className='ai-scanner__section-header'>
                                <SparkleIcon />
                                <span>Digits Scanner</span>
                            </div>
                            <p className='ai-scanner__section-desc'>
                                {STRATEGIES.find(s => s.key === strategy)?.description}
                            </p>

                            <div className='ai-scanner__ticks-row'>
                                <span className='ai-scanner__ticks-label'>TICKS</span>
                                <input
                                    className='ai-scanner__ticks-input'
                                    type='number'
                                    min={100}
                                    max={5000}
                                    step={100}
                                    value={ticks}
                                    disabled={isScanning}
                                    onChange={e =>
                                        setTicks(
                                            Math.max(100, Math.min(5000, parseInt(e.target.value) || 1000))
                                        )
                                    }
                                />
                            </div>

                            <div className='ai-scanner__fields'>
                                <div className='ai-scanner__field'>
                                    <label className='ai-scanner__field-label'>SELECTED MARKET</label>
                                    <div className='ai-scanner__field-value'>
                                        {result ? result.marketName : 'Scan to find the best market'}
                                    </div>
                                </div>
                                <div className='ai-scanner__field'>
                                    <label className='ai-scanner__field-label'>TRADE TYPE</label>
                                    <div className='ai-scanner__field-value'>
                                        {result ? (
                                            <>
                                                {result.tradeType}
                                                <span className='ai-scanner__win-rate'>
                                                    {result.winRate.toFixed(1)}%
                                                </span>
                                            </>
                                        ) : (
                                            'Waiting for scan'
                                        )}
                                    </div>
                                </div>
                            </div>

                            {isScanning && (
                                <div className='ai-scanner__progress-track'>
                                    <div
                                        className='ai-scanner__progress-fill'
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            )}

                            <div className='ai-scanner__status'>
                                {statusMsg || `Ready to scan ${readyLabel}.`}
                            </div>

                            <div className='ai-scanner__actions'>
                                <button
                                    className='ai-scanner__btn ai-scanner__btn--primary'
                                    onClick={handleScan}
                                    disabled={isScanning}
                                >
                                    {isScanning ? (
                                        <>
                                            <span className='ai-scanner__spinner' />
                                            Scanning...
                                        </>
                                    ) : (
                                        'Scan Markets'
                                    )}
                                </button>
                                <button
                                    className='ai-scanner__btn ai-scanner__btn--secondary'
                                    onClick={handleLoadBot}
                                    disabled={isScanning}
                                >
                                    Load Scanner Bot
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AIScanner;
