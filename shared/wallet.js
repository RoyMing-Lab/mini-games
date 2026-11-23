/*!
 * 🪙 공용 코인 지갑 (Mini Games Shared Wallet)
 * ------------------------------------------------------------
 * 모든 미니게임이 하나의 잔액을 함께 쓴다.
 *   - 저장 키: localStorage["casino_chips"]  (기존 게임들과 호환)
 *   - 기본 잔액: 10,000
 *
 * 사용법
 *   const bal = Wallet.getBalance();       // 현재 공용 잔액 읽기
 *   Wallet.setBalance(bal - bet);          // 베팅 차감 / 지급 / 충전 (즉시 저장)
 *   Wallet.addBalance(+5000);              // 증감
 *   const off = Wallet.subscribe((bal, info) => { ... });  // 다른 탭·게임·bfcache 복원 시 알림
 *
 * subscribe 콜백은 "바깥에서 잔액이 바뀌었을 때"만 불린다.
 *   info.source: 'storage' | 'pageshow' | 'bfcache' | 'visibility' | 'focus' | 'manual'
 *   같은 페이지에서 Wallet.setBalance()로 바꾼 값은 게임이 직접 렌더링하므로 알림하지 않는다.
 *
 * 내장 동기화
 *   - storage  : 다른 탭에서 잔액이 바뀐 경우
 *   - pageshow : 뒤로가기/앞으로가기(bfcache 복원) 포함
 *   - visibilitychange / focus : 모바일 앱 전환 후 복귀
 *   - 1회성 마이그레이션: 예전 개별 키의 잔액을 casino_chips로 안전하게 이관
 */
(function (global) {
    'use strict';

    var CHIP_KEY = 'casino_chips';
    var DEFAULT_BALANCE = 10000;
    var MIGRATION_FLAG = 'casino_chips_migrated_v1';

    /* 예전에 게임별로 따로 쓰던 잔액 저장소들 (값이 가장 큰 것을 이관) */
    var LEGACY_SOURCES = [
        { key: 'baccarat_chips' },
        { key: 'casino21_chips' },
        { key: 'arcade_coin_flip_state', json: ['balance', 'chips'] },
        { key: 'hilo_balance' },
        { key: 'pixel_derby_chips' },
        { key: 'mahjong_balance' },
        { key: 'mines_balance' },
        { key: 'plinko_balance' },
        { key: 'roulette_balance' },
        { key: 'sicbo_balance' },
        { key: 'video_poker_chips' },
        { key: 'roaming_odd_even_game', json: ['chips', 'balance'] }
    ];

    var current = null;          // 마지막으로 확인한 공용 잔액
    var listeners = [];          // subscribe 콜백
    var storageOK = true;

    function toBalance(value) {
        var n = Math.floor(Number(value));
        if (!isFinite(n) || n < 0) return null;
        return n;
    }

    function readStored() {
        if (!storageOK) return null;
        try {
            var raw = global.localStorage.getItem(CHIP_KEY);
            if (raw === null) return null;
            return toBalance(raw);
        } catch (e) {
            storageOK = false;
            return null;
        }
    }

    function writeStored(value) {
        try {
            global.localStorage.setItem(CHIP_KEY, String(value));
        } catch (e) {
            /* 사파리 프라이빗 모드 등 저장 불가 환경에서도 게임은 계속 동작 */
        }
    }

    function readLegacyValue(src) {
        var raw = null;
        try { raw = global.localStorage.getItem(src.key); } catch (e) { return null; }
        if (raw === null) return null;

        if (!src.json) return toBalance(raw);

        try {
            var obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') return null;
            for (var i = 0; i < src.json.length; i++) {
                var v = toBalance(obj[src.json[i]]);
                if (v !== null) return v;
            }
        } catch (e) { /* 깨진 JSON은 무시 */ }
        return null;
    }

    function migrateOnce() {
        try {
            if (global.localStorage.getItem(MIGRATION_FLAG) === '1') return;
        } catch (e) { return; }

        if (readStored() !== null) {
            try { global.localStorage.setItem(MIGRATION_FLAG, '1'); } catch (e) {}
            return;
        }

        var best = null;
        for (var i = 0; i < LEGACY_SOURCES.length; i++) {
            var v = readLegacyValue(LEGACY_SOURCES[i]);
            if (v !== null && (best === null || v > best)) best = v;
        }
        if (best !== null) writeStored(best);

        try { global.localStorage.setItem(MIGRATION_FLAG, '1'); } catch (e) {}
    }

    function clampBalance(value) {
        var n = toBalance(value);
        return n === null ? 0 : n;
    }

    function getBalance() {
        var stored = readStored();
        if (stored !== null) {
            current = stored;
        } else if (current === null) {
            current = DEFAULT_BALANCE;
        }
        return current;
    }

    function setBalance(value) {
        var n = clampBalance(value);
        current = n;
        writeStored(n);
        return n;
    }

    function addBalance(delta) {
        return setBalance(getBalance() + (Number(delta) || 0));
    }

    function notify(balance, source) {
        var info = { source: source, key: CHIP_KEY };
        for (var i = 0; i < listeners.length; i++) {
            try {
                listeners[i](balance, info);
            } catch (e) {
                if (global.console) global.console.error('[wallet] subscriber error', e);
            }
        }
    }

    /* 바깥 저장소에서 잔액을 다시 읽어온다. force면 값이 같아도 알린다. */
    function refresh(source, force) {
        var stored = readStored();
        var next;
        if (stored !== null) next = stored;
        else next = (current === null ? DEFAULT_BALANCE : current);

        var prev = current;
        current = next;

        if (force || prev !== next) notify(next, source);
        return next;
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function unsubscribe() {
            var idx = listeners.indexOf(fn);
            if (idx >= 0) listeners.splice(idx, 1);
        };
    }

    migrateOnce();

    if (global.addEventListener) {
        global.addEventListener('storage', function (e) {
            if (!e || !e.key || e.key === CHIP_KEY) refresh('storage', false);
        });

        global.addEventListener('pageshow', function (e) {
            refresh(e && e.persisted ? 'bfcache' : 'pageshow', true);
        });

        global.addEventListener('focus', function () {
            refresh('focus', false);
        });

        if (global.document && global.document.addEventListener) {
            global.document.addEventListener('visibilitychange', function () {
                if (!global.document.hidden) refresh('visibility', true);
            });
        }
    }

    var Wallet = {
        CHIP_KEY: CHIP_KEY,
        DEFAULT_BALANCE: DEFAULT_BALANCE,
        getBalance: getBalance,
        setBalance: setBalance,
        addBalance: addBalance,
        subscribe: subscribe,
        refresh: function (source) { return refresh(source || 'manual', true); },
        format: function (value) {
            return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
        }
    };

    global.Wallet = Wallet;

    if (typeof module !== 'undefined' && module.exports) module.exports = Wallet;
})(typeof window !== 'undefined' ? window : this);
