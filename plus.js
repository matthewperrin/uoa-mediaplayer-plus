const BASE_CLASS = 'ShakaPlayerPlus';
const VOLUME_STEP = 0.05;
const RATE_STEP = 0.25;
const SMALL_TIME_STEP = 5;
const LARGE_TIME_STEP = 15;
const FRAME_RATE = 15; /// one must parse the actual stream data to figure this information out, or just make a simple assumption
const FRAME_TIME_STEP = 1 / FRAME_RATE;
const DEFAULT_PLAYBACK_SPEED = 1;
const SKIP_COPYRIGHT_POSITION = 42;
const DEFAULT_VOLUME = 1;
const DEFAULT_AUTOPLAY = true;
const DEFAULT_MUTE = false;
const DEFAULT_LOOP = false;

const template = (strings, ...args) => {
	return strings.map((curr, idx, arr) => { return (idx <= args.length - 1) ? `${curr}${args[idx]}` : strings.slice(idx).join(''); }).join('');
};

/// a filtered set of htmlvideoelement and htmlmediaelement property names (and none of htmlelement or its prototypes)
const validVideoMediaKeys = [
	'currentTime',
	'playbackRate',
	'autoplay',
	'loop',
	'volume',
	'muted'
];

class SPP {
	constructor(window) {
		const $ = this;
		$._ = $.constructor;

		if (!(window instanceof Window))
			throw new $._.SPPError('SPPPARM');

		(() => {
			$.state = {
				initialised: false,
				loaded: false, /// indicates stored config was loaded
				speed: 1
			};

			$.controls = {
				obj: null,
				timer: null, 
			};

			$.video = {
				obj: null,
				meta: {
					year: null,
					code: null,
					booking: null,
					stamp: null,
					hash: null,
					file: {
						timestamp: null,
						theatre: null
					}
				}
			};

			$.popup = {
				obj: null,
				timer: null
			};

			$.anchors = {
				mpp: {}
			};

			$.window = window;
			$.document = $.window.document;
			$.chrome = chrome;
		})(/*!< initialise state */);

		/// main
		const main = function() {
			const $ = this;

			if (!($ instanceof SPP))
				throw new SPP.SPPError('SPPINIT');

			/// short-circuit
			if ($.state.initialised)
				return;
			else
				$.state.initialised = true;

			$.init()
				.then($._loadConfig.bind($))
				.then($._registerListeners.bind($))
				.then($._preset.bind($))
				.then($._go.bind($))
				.catch((err) => {
					if (err instanceof Error)
						throw err;
					else
						throw new $._.SPPError(err);
				});
		};

		$.document.arrive('.shaka-volume-bar-container', main.bind($));
	}

	init() {
		const $ = this;
		const prefixString = `${$._.name}.init()`;

		return new Promise((resolve, reject) => {
			(() => {
				/// pick apart the url
				const loc = $.window.location.href;
				const locParts = loc.match(/^(?<proto>[^:]+):\/\/(?<fqdn>[^\/]+)\/(?<year>[^\/]+)\/(?<code>[^\/]+)\/(?<booking>[^\/]+)\/(?<stamp>[^\/]+)\/(?<hash>[^\/]+)\/(?<file>[^\/]+)\.(?:preview)$/);

				if (locParts === null)
					throw new $._.SPPError('SPPDOMAIN', prefixString);

				Object.assign($.video.meta, locParts.groups);

				const fileParts = locParts.groups.file.match(/(?<timestamp>\d+)\.(?<theatre>.+)/);

				/// throw if not recognised
				if (fileParts === null)
					throw new $._.SPPError('SPPDOMAIN', prefixString, 'FILE_PARTS');

				$.video.meta.file = {};
				Object.assign($.video.meta.file, fileParts.groups);

				const tTimestamp = $.video.meta.file.timestamp;

				/// decode the recording timestamp
				if (tTimestamp.match(/^\d{12}$/) !== null)
					$.video.meta.file.timestamp = new Date(tTimestamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, (...params) => { return `${params[1]}-${params[2]}-${params[3]} ${params[4]}:${params[5]}:00`; }));
				
				/// throw if the filename contains no date
				if ($.video.meta.file.timestamp.toString() === 'Invalid Date')
					throw new $._.SPPError('SPPDOMAIN', prefixString, 'INVALID_DATE');
			})(/*!< derive runtime state from current window.location.href */);

			(() => {
				/** @todo: do not assume singular */
				/// anchor elements
				$.anchors.videoContainer = $.document.getElementsByClassName('shaka-video-container')[0];
				$.anchors.volumeSlider = $.document.getElementsByClassName('shaka-volume-bar-container')[0];
				$.anchors.currentTime = $.document.getElementsByClassName('shaka-current-time')[0];
				$.anchors.volumeBar = $.document.getElementsByClassName('shaka-volume-bar-container')[0];
				$.anchors.speedChanger = $.document.getElementsByClassName('shaka-playback-rates')[0];

				/// templates
				const actionPopup = '<div id=\'mpp-action-popup\'></div>';
				const downloadButton = '<button class=\'material-icons\' id=\'mpp-download\' aria-label=\'Download\' title=\'Download\'>get_app</button>';
				const screenshotButton = '<button class=\'material-icons\' id=\'mpp-screenshot\' aria-label=\'Screenshot\' title=\'Take Screenshot\'>wallpaper</button>';
				const playButton = '<button class=\'material-icons\' id=\'mpp-play\' aria-label=\'Play/Pause\' title=\'Play/Pause\'>play_arrow</button>';
				const volumeButton = '<button class=\'material-icons\' id=\'mpp-volume\' aria-label=\'Toggle Sound\' title=\'Toggle Sound\'>volume_up</button>';

				/// insert templates
				$.anchors.videoContainer.insertAdjacentHTML('afterbegin', actionPopup);
				$.anchors.volumeSlider.insertAdjacentHTML('afterend', downloadButton);
				$.anchors.volumeSlider.insertAdjacentHTML('afterend', screenshotButton);
				$.anchors.currentTime.insertAdjacentHTML('beforebegin', playButton);
				$.anchors.volumeBar.insertAdjacentHTML('beforebegin', volumeButton);

				/// allocate objects
				$.video.obj = $.document.getElementById('video');
				$.popup.obj = $.document.getElementById('mpp-action-popup');
				$.controls.obj = $.document.getElementsByClassName('shaka-controls-container')[0];

				/// minor anchors
				$.anchors.mpp.actionPopup = $.document.getElementById('mpp-action-popup');
				$.anchors.mpp.download = $.document.getElementById('mpp-download');
				$.anchors.mpp.screenshot = $.document.getElementById('mpp-screenshot');
				$.anchors.mpp.play = $.document.getElementById('mpp-play');
				$.anchors.mpp.volume = $.document.getElementById('mpp-volume');
			})(/*!< create mpp interface */);

			resolve();
		});
	}

	_go() {
		const $ = this;

		if (!($.video.obj instanceof HTMLVideoElement)
			|| !$.state.initialised)
			throw new $._.SPPError('SPPSTATE');

		if ($.video.obj.autoplay)
			$.video.obj.play();
	}

	/** @brief setup the default playback speed, rate, skip to 42s etc */
	_preset() {
		const $ = this;

		return new Promise((resolve, reject) => {
			if (!$.state.loaded) {
				$.video.obj.currentTime = SKIP_COPYRIGHT_POSITION;
				$.video.obj.playbackRate = DEFAULT_PLAYBACK_SPEED;
				$.video.obj.autoplay = DEFAULT_AUTOPLAY;
				$.video.obj.loop = DEFAULT_LOOP;
				$.video.obj.volume = DEFAULT_VOLUME;
				$.video.obj.muted = DEFAULT_MUTE;
			}
			
			resolve();
		});
	}

	_registerListeners() {
		const $ = this;

		return new Promise((resolve, reject) => {
			if (!($.video.obj instanceof HTMLVideoElement)
				|| !$.state.initialised)
				throw new $._.SPPError('SPPSTATE');

			/// before the user leaves, save settings
			$.window.onbeforeunload = $._saveConfig.bind($);

			$.document.addEventListener('keydown', $._keyPressed.bind($));
			$.document.addEventListener('visibilitychange', $.popup.obj.classList.remove.bind($, 'show-action-popup')); /// make sure popup is hidden

			(() => {
				/// video object
				$.video.obj.addEventListener('play', (e) => {
					$.video.obj.playbackRate = $.state.speed; /// make sure playback speed is still correct
					$.anchors.mpp.play.innerHTML = 'pause' /// update play icon
				});

				$.video.obj.addEventListener('pause', (e) => {
					$.anchors.mpp.play.innerHTML = 'play_arrow' /// update play icon
				});

				/// handled before ion, so the states are inverted
				$.anchors.videoContainer.addEventListener('click', (e) => {
					if ($.video.obj.paused)
						$._showPopup('pause', 'Pause');
					else
						$._showPopup('play_arrow', 'Play');
				});
		
				// download button
				$.anchors.mpp.download.addEventListener('click', (e) => {
					const mp4URI = $.window.location.href.replace('.preview', '.mp4');

					$.window.open(mp4URI, '_blank');
				});
		
				// snapshot button
				$.anchors.mpp.screenshot.addEventListener('click', (e) => {
					const canvas = $.document.createElement('canvas');
					canvas.width = $.video.obj.videoWidth;
					canvas.height = $.video.obj.videoHeight;
					const ctx = canvas.getContext('2d');

					ctx.drawImage($.video.obj, 0, 0, canvas.width, canvas.height);
					downloadURI(canvas.toDataURL('image/png'), 'My Screenshot');
				});
		
				// keep intended speed
				$.anchors.speedChanger.addEventListener('click', (e) => {
					$.state.speed = $.video.obj.playbackRate;
				});
		
				// play/pause button
				$.anchors.mpp.play.addEventListener('click', (e) => {
					$.video.obj.paused ? $.video.obj.play() : $.video.obj.pause();
				});
		
				// volume button
				$.anchors.mpp.volume.addEventListener('click', (e) => {
					$.video.obj.muted = !$.video.obj.muted;
				});

				$.video.obj.addEventListener('volumechange', function() {
					if ($.video.obj.muted)
						$.anchors.mpp.volume.innerHTML = 'volume_off'
					else if ($.video.obj.volume < 0.5)
						$.anchors.mpp.volume.innerHTML = 'volume_down'
					else
						$.anchors.mpp.volume.innerHTML = 'volume_up'
				});
			})(/*!< listeners on mpp elements */);

			resolve();
		});
	}

	static _generateVideoID(file) {
		const $ = this;

		if (typeof file !== 'object'
			|| !('timestamp' in file)
			|| !('theatre' in file)
			|| !(file.timestamp instanceof Date)
			|| typeof file.theatre !== 'string'
			|| file.theatre.length === 0)
			throw new $._.SPPError('SPPPARM');

		/// e.g.: '2020-10-29T16:00'
		const tTimestamp = new Date(file.timestamp.getTime() - (file.timestamp.getTimezoneOffset() * 60 * 1000)).toISOString().slice(0, -8);
		const fTimestamp = tTimestamp.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/, (...params) => { return `${params[1]}${params[2]}${params[3]}${params[4]}${params[5]}`; });

		/// e.g.: '202010291600.LT347653'
		return `${fTimestamp}.${file.theatre}`;
	}

	/** @brief to be called once the video element is present - will restore previous playback settings */
	_loadConfig() {
		const $ = this;
		const vID = $._._generateVideoID($.video.meta.file); /// video-id - valid only after $.init

		return new Promise((resolve, reject) => {
			if (!($.video.obj instanceof HTMLVideoElement)
				|| !$.state.initialised)
				throw new $._.SPPError('SPPSTATE');

			$.chrome.storage.sync.get(vID, (retObj) => {
				if ($.chrome.runtime.lastError) {
					throw new $._.SPPError('SPPCSTORE', $.chrome.runtime.lastError.message);
				} else {
					if (typeof retObj[vID] === 'string') {
						const rPayload = JSON.parse(retObj[vID]);
						const pPayload = Object.keys(rPayload).filter((x) => { return validVideoMediaKeys.includes(x); }).reduce((acc, curr) => { acc[curr] = rPayload[curr]; return acc; }, {});

						Object.assign($.video.obj, pPayload);

						$.state.loaded = true;
					}

					resolve();
				}
			});
		});
	}

	/** @todo fix this up to actually work */
	_saveConfig() {
		const $ = this;
		const vID = $._._generateVideoID($.video.meta.file); /// video-id - valid only after $.init
		const storageObj = {};

		if (!($.video.obj instanceof HTMLVideoElement))
			throw new $._.SPPError('SPPSTATE');

		validVideoMediaKeys.forEach((curr, idx, arr) => {
			storageObj[curr] = $.video.obj[curr];
		});

		const pData = JSON.stringify(storageObj, (k, v) => {
			return typeof v === 'undefined' ? null : v;
		});

		/// store valid keys, replacing undefined with null
		$.chrome.storage.sync.set({[vID]: pData}, () => {
			if ($.chrome.runtime.lastError)
				throw new $._.SPPError('SPPCSTORE', $.chrome.runtime.lastError.message);
			else
				return;
		});
	}

	_showPopup(ico, str) {
		const $ = this;

		if (arguments.length !== 2
			|| (typeof ico !== 'string'
				|| ico.length === 0)
			|| (typeof str !== 'string'
				|| str.length === 0))
			throw new $._.SPPError('SPPPARM');

		if (!($.popup.obj instanceof HTMLDivElement))
			throw new $._.SPPError('SPPSTATE');

		$.popup.obj.innerHTML = `<span class='material-icons'>${ico}</span><p>${str}</p>`;
		$.popup.obj.classList.add('show-action-popup');
		
		clearTimeout($.popup.timer);
		$.popup.timer = setTimeout(() => { $.popup.obj.classList.remove('show-action-popup'); }, 500);
	}

	/** @brief only valid when invoked by 'keydown' with e instanceof keyboardevent */
	_keyPressed(e) {
		const $ = this;
		const prefixString = `${$._.name}._keyPressed(\u2026)`;
		
		/// short-circuit
		if ($.state.initialised === false
			|| !($.controls.obj instanceof HTMLDivElement)
			|| !(e instanceof KeyboardEvent)
			|| e.type !== 'keydown')
			throw new $._.SPPError('SPPSTATE');

		/// prevent unexpected browser behaviour
		e.preventDefault();
		$.document.activeElement.blur();

		(() => {
			clearTimeout($.controls.timer);
			$.controls.obj.setAttribute('shown', 'true');
			$.controls.timer = setTimeout(() => {
				$.controls.obj.removeAttribute('shown');
			}, 5000);
		})(/*!< debounce key presses */);

		const video = $.video.obj;

		/*!< @note hotkey management, ignore modifier keys @deprecated-usage */
		switch (e.code) {
			/// play/pause
			case 'Space':
			case 'KeyK':
				if (video.paused) {
					video.play();
					$._showPopup('play_arrow', 'Play');
				} else {
					video.pause();
					$._showPopup('pause', 'Pause');
				}
				break;

			/// maximmise
			case 'KeyF':
				$.document.getElementsByClassName('shaka-fullscreen-button')[0].click();
				break;

			/// seek forwards 5s
			case 'KeyL':
			case 'ArrowRight': {
				const toTime = video.currentTime + ((!e.ctrlKey && e.shiftKey) ? FRAME_TIME_STEP : ((!e.shiftKey && e.ctrlKey) ? LARGE_TIME_STEP : SMALL_TIME_STEP));
				video.currentTime = toTime > video.duration ? video.duration : toTime;

				if (e.shiftKey)
					video.pause();

				$._showPopup('skip_next', 'Seek');
				break;
			}

			/// seek backwards 5s
			case 'KeyJ':
			case 'ArrowLeft': {
				const toTime = video.currentTime - ((!e.ctrlKey && e.shiftKey) ? FRAME_TIME_STEP : ((!e.shiftKey && e.ctrlKey) ? LARGE_TIME_STEP : SMALL_TIME_STEP));
				video.currentTime = toTime < 0 ? 0 : toTime;

				if (e.shiftKey)
					video.pause();

				$._showPopup('skip_previous', 'Seek');
				break;
			}

			/// increase volume
			case 'ArrowUp': {
				const toVol = video.volume + VOLUME_STEP;
				video.volume = toVol > 1 ? 1 : toVol;

				$._showPopup('volume_up', `${Math.round(video.volume * 100).toString(10)}%`);
				break;
			}

			/// decreae volume
			case 'ArrowDown': {
				const toVol = video.volume - VOLUME_STEP;
				video.volume = toVol < 0 ? 0 : toVol;

				$._showPopup('volume_down', `${Math.round(video.volume * 100).toString(10)}%`);
				break;
			}

			/// increase playback speed
			case 'Period': { /// eww america
				const toRate = video.playbackRate + RATE_STEP;
				video.playbackRate = toRate > 3 ? 3 : toRate;
				$.state.speed = video.playbackRate;

				$._showPopup('fast_forward', `${video.playbackRate.toString(10)}x`);
				break;
			}

			/// decrease playback speed
			case 'Comma': {
				const toRate = video.playbackRate - RATE_STEP;
				video.playbackRate = toRate < RATE_STEP ? RATE_STEP : toRate;
				$.state.speed = video.playbackRate;

				$._showPopup('fast_rewind', `${video.playbackRate.toString(10)}x`);
				break;
			}

			/// reset playback speed
			case 'Slash': /// '/'
				video.playbackRate = DEFAULT_PLAYBACK_SPEED;
				$.state.speed = video.playbackRate;

				$._showPopup('speed', '1x');
				break;

			/// toggle mute
			case 'KeyM': /// 'm'
				video.muted = !video.muted;
				video.muted ? $._showPopup('volume_off', 'Muted') : $._showPopup('volume_up', 'Unmuted');
				break;

			/// unhandled keys
			default:
				console.log(`${prefixString}: 0x${(Array(2).join('0') + e.keyCode.toString(16).toUpperCase()).substr(-2)} (${e.code}), $.state.initialised: ${$.state.initialised ? 'true' : 'false'}, $.controls.obj: {${$.controls.obj.constructor.name}}, $.video.obj: {${$.video.obj.constructor.name}}, e: {${e.constructor.name}}`);
				break;
		}
	}

	/*!< @desc ShakaPlayerPlus valid errors */
	static get SPP_ERROR() {
		let i = 0;

		return {
			SPPGEN:			{ message: `${BASE_CLASS} General Failure!`, id: (++i) },
			SPPPARM:		{ message: 'Invalid Parameters', id: (i = 0) },
			SPPARGS:		{ message: 'Takes No Arguments', id: (++i) },
			SPPBADERROR:	{ message: `${BASE_CLASS} Bad Error`, id: (++i) },
			SPPSTATE:		{ message: `${BASE_CLASS} Reached an Invalid State`, id: (++i) },
			SPPINIT:		{ message: `${BASE_CLASS} Failed to Initialise`, id: (++i) },
			SPPCSTORE:		{ message: (...args) => { return template(['', ` ${BASE_CLASS} Chrome Storage Failure: `, ''], ...args); }, id: (++i) },
			SPPTYPE:		{ message: (...args) => { return template(['', ` ${BASE_CLASS} Type Mistamatch: \u2018`, '\u2019 is \u2018', '\u2019 and value is \u2018', '\u2019'], ...args); }, id: (++i) },
			SPPDOMAIN:		{ message: (...args) => { return template(['', ` ${BASE_CLASS} Invoked on Invalid Domain: `, ''], ...args); }, id: (++i) }
		};
	}

	static get SPP_ERROR_LOOKUP() {
		const $ = this;

		return new Map(Object.entries($.SPP_ERROR).map(([key, value]) => { return [value, key]; }));
	}

	/**
	 * @class $.SPPError - SPP Error class
	 * @note creates SPPGEN - General Error
	 * @note creates SPPBADERROR - Bad Error ID
	 */
	static get SPPError() {
		const $ = this;

		return class SPPObjError extends Error {
			constructor(code, ...args) {
				if (typeof code === 'string') {
					if (args.length !== 0) {
						const functor = $.SPP_ERROR[code].message;

						if (functor instanceof Function)
							super(functor(...args));
						else
							super($.SPP_ERROR[code].message);

						const $$ = this;
						$$.name = $$.constructor.name;
						Error.captureStackTrace($$, $$.constructor);
						$$.code = code;
					} else {
						const err = $.SPP_ERROR[code];

						if (typeof err !== 'object'
							|| typeof err.message !== 'string') {
							const bad = 'SPPBADERROR';
							super($.SPP_ERROR[bad].message);

							const $$ = this;
							$$.name = $$.constructor.name;
							Error.captureStackTrace($$, $$.constructor);
							$$.code = bad;
						} else {
							super($.SPP_ERROR[code].message);

							const $$ = this;
							$$.name = $$.constructor.name;
							Error.captureStackTrace($$, $$.constructor);
							$$.code = code;
						}
					}
				} else {
					const general = 'SPPGEN';
					super(`${$.SPP_ERROR[general].message}, code: ${code}, args: ${args.join()}`);

					const $$ = this;
					$$.name = $$.constructor.name;
					Error.captureStackTrace($$, $$.constructor);
					$$.code = general;
				}
			}
		};
	}
}

const iSPP = new SPP(window);
