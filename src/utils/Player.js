import { getAlbum } from '@/api/album';
import { getArtist } from '@/api/artist';
import { trackScrobble, trackUpdateNowPlaying } from '@/api/lastfm';
import { fmTrash, personalFM } from '@/api/others';
import { getPlaylistDetail, intelligencePlaylist } from '@/api/playlist';
import { getLyric, getMP3, getTrackDetail, scrobble } from '@/api/track';
import store from '@/store';
import { isAccountLoggedIn } from '@/utils/auth';
import { cacheTrackSource, getTrackSource } from '@/utils/db';
import { isCreateMpris, isCreateTray } from '@/utils/platform';
import shuffle from 'lodash/shuffle';

const INDEX_IN_PLAY_NEXT = -1;

/**
 * @readonly
 * @enum {string}
 */
const UNPLAYABLE_CONDITION = {
  PLAY_NEXT_TRACK: 'playNextTrack',
  PLAY_PREV_TRACK: 'playPrevTrack',
};

/**
 * @readonly
 * @enum {string}
 */
const PLAYER_STATE = {
  IDLING: 'idling',
  LOADING_NEXT: 'loading next',
  LOADING_CURRENT: 'loading current',
  IN_PROGRESS: 'in progress',
};

const electron =
  process.env.IS_ELECTRON === true ? window.require('electron') : null;
const ipcRenderer =
  process.env.IS_ELECTRON === true ? electron.ipcRenderer : null;
const delay = ms =>
  new Promise(resolve => {
    setTimeout(() => {
      resolve('');
    }, ms);
  });
const excludeSaveKeys = [
  '_playing',
  '_personalFMLoading',
  '_personalFMNextLoading',
  '_trackSeqNum',
  '_cacheAvailable',
  '_cachedTrackSource',
];

let audio;
let cacheAudio;

function setTitle(track) {
  document.title = track
    ? `${track.name} · ${track.ar[0].name} - YesPlayMusic`
    : 'YesPlayMusic';
  if (isCreateTray) {
    ipcRenderer?.send('updateTrayTooltip', document.title);
  }
  store.commit('updateTitle', document.title);
}

function setTrayLikeState(isLiked) {
  if (isCreateTray) {
    ipcRenderer?.send('updateTrayLikeState', isLiked);
  }
}

export default class {
  constructor() {
    // 播放器状态
    this._progress = 0; // 当前播放歌曲的进度
    this._enabled = false; // 是否启用Player
    this._repeatMode = 'off'; // off | on | one
    this._shuffle = false; // true | false
    this._reversed = false;
    this._volume = 1; // 0 to 1
    this._volumeBeforeMuted = 1; // 用于保存静音前的音量
    this._personalFMLoading = false; // 是否正在私人FM中加载新的track
    this._personalFMNextLoading = false; // 是否正在缓存私人FM的下一首歌曲
    this._currentTrackSource = null;

    // 播放信息
    this._list = []; // 播放列表
    this._current = 0; // 当前播放歌曲在播放列表里的index
    this._shuffledList = []; // 被随机打乱的播放列表，随机播放模式下会使用此播放列表
    this._shuffledCurrent = 0; // 当前播放歌曲在随机列表里面的index
    this._playlistSource = { type: 'album', id: 123 }; // 当前播放列表的信息
    this._currentTrack = { id: 86827685 }; // 当前播放歌曲的详细信息
    this._playNextList = []; // 当这个list不为空时，会优先播放这个list的歌
    this._isPersonalFM = false; // 是否是私人FM模式
    this._personalFMTrack = { id: 0 }; // 私人FM当前歌曲
    this._personalFMNextTrack = {
      id: 0,
    }; // 私人FM下一首歌曲信息（为了快速加载下一首）

    /**
     * The blob records for cleanup.
     *
     * @private
     * @type {string[]}
     */
    this.createdBlobRecords = [];

    // init
    this._init();

    window.yesplaymusic = {};
    window.yesplaymusic.player = this;
  }

  get repeatMode() {
    return this._repeatMode;
  }
  set repeatMode(mode) {
    if (this._isPersonalFM) return;
    if (!['off', 'on', 'one'].includes(mode)) {
      console.warn("repeatMode: invalid args, must be 'on' | 'off' | 'one'");
      return;
    }
    this._repeatMode = mode;
  }
  get shuffle() {
    return this._shuffle;
  }
  set shuffle(shuffle) {
    if (this._isPersonalFM) return;
    if (shuffle !== true && shuffle !== false) {
      console.warn('shuffle: invalid args, must be Boolean');
      return;
    }
    this._shuffle = shuffle;
    if (shuffle) {
      this._shuffleTheList();
    }
  }
  get reversed() {
    return this._reversed;
  }
  set reversed(reversed) {
    if (this._isPersonalFM) return;
    if (reversed !== true && reversed !== false) {
      console.warn('reversed: invalid args, must be Boolean');
      return;
    }
    console.log('changing reversed to:', reversed);
    this._reversed = reversed;
  }
  get volume() {
    return this._volume;
  }
  set volume(volume) {
    this._volume = volume;
    audio.volume = volume;
  }
  get list() {
    return this.shuffle ? this._shuffledList : this._list;
  }
  set list(list) {
    this._list = list;
  }
  get current() {
    return this.shuffle ? this._shuffledCurrent : this._current;
  }
  set current(current) {
    if (this.shuffle) {
      this._shuffledCurrent = current;
    } else {
      this._current = current;
    }
  }
  get enabled() {
    return this._enabled;
  }
  get loading() {
    return (
      this._state === PLAYER_STATE.LOADING_CURRENT ||
      this._state === PLAYER_STATE.LOADING_NEXT
    );
  }
  get playing() {
    return this._playing;
  }
  set playing(playing) {
    this._playing = playing;
    if (playing) {
      navigator.mediaSession.playbackState = 'playing';
    } else {
      navigator.mediaSession.playbackState = 'paused';
    }
    if (isCreateTray) {
      ipcRenderer?.send('updateTrayPlayState', this.playing);
    }
  }
  get currentTrack() {
    return this._currentTrack;
  }
  get currentTrackID() {
    return this._currentTrack?.id ?? 0;
  }
  get playlistSource() {
    return this._playlistSource;
  }
  get playNextList() {
    return this._playNextList;
  }
  get isPersonalFM() {
    return this._isPersonalFM;
  }
  get personalFMTrack() {
    return this._personalFMTrack;
  }
  get currentTrackDuration() {
    const trackDuration = this._currentTrack.dt || 1000;
    let duration = ~~(trackDuration / 1000);
    return duration > 1 ? duration - 1 : duration;
  }
  get progress() {
    return this._progress;
  }
  set progress(time) {
    this.seek(time, true);
  }
  get isCurrentTrackLiked() {
    return store.state.liked.songs.includes(this.currentTrack.id);
  }

  _init() {
    this._loadSelfFromLocalStorage();

    audio = document.createElement('audio');
    audio.preload = 'auto';
    cacheAudio = document.createElement('audio');
    cacheAudio.preload = 'auto';

    this._state = PLAYER_STATE.IDLING; // 是否正在播放中
    this._playing = false;
    this._trackSeqNum = 0;
    this._cacheAvailable = false;
    this._cachedTrackSource = null;

    this._audioEndedEventHandler = () => {
      console.debug(`Handling ended event while ${this._state}`);
      this._nextTrackCallback();
    };

    if (this._enabled) {
      // 恢复当前播放歌曲
      this._replaceCurrentTrack(this.currentTrackID, false).then(() => {
        this.seek(localStorage.getItem('playerCurrentTrackTime') ?? 0);
      }); // update audio source and init
    }

    this._setIntervals();

    // 初始化私人FM
    if (
      this._personalFMTrack.id === 0 ||
      this._personalFMNextTrack.id === 0 ||
      this._personalFMTrack.id === this._personalFMNextTrack.id
    ) {
      personalFM().then(result => {
        this._personalFMTrack = result.data[0];
        this._personalFMNextTrack = result.data[1];
        return this._personalFMTrack;
      });
    }
  }
  _setIntervals() {
    // 同步播放进度
    // TODO: 如果 _progress 在别的地方被改变了，
    // 这个定时器会覆盖之前改变的值，是bug
    setInterval(() => {
      if (
        (this._state === PLAYER_STATE.IN_PROGRESS &&
          this.playing &&
          this._progress === audio.currentTime &&
          audio.currentTime >= this.currentTrack.dt / 1000 - 2) ||
        (this._state === PLAYER_STATE.IN_PROGRESS &&
          this.playing &&
          audio.currentTime >= this.currentTrack.dt / 1000 + 2)
      ) {
        this._nextTrackCallback();
      }
      this._progress = audio.currentTime;
      localStorage.setItem('playerCurrentTrackTime', this.progress);
      if (isCreateMpris) {
        ipcRenderer?.send('playerCurrentTrackTime', this.progress);
      }
    }, 1000);
  }
  _getNextTrack() {
    const next = this._reversed ? this.current - 1 : this.current + 1;

    if (this._playNextList.length > 0) {
      let trackID = this._playNextList[0];
      return [trackID, INDEX_IN_PLAY_NEXT, false];
    }

    // 循环模式开启，则重新播放当前模式下的相对的下一首
    if (this._reversed && this.current === 0) {
      // 倒序模式，当前歌曲是第一首，则重新播放列表最后一首
      return [
        this.list[this.list.length - 1],
        this.list.length - 1,
        this.repeatMode !== 'on',
      ];
    } else if (this.list.length === this.current + 1) {
      // 正序模式，当前歌曲是最后一首，则重新播放第一首
      return [this.list[0], 0, this.repeatMode !== 'on'];
    }

    // 返回 [trackID, index]
    return [this.list[next], next, false];
  }
  _getPrevTrack() {
    const next = this._reversed ? this.current + 1 : this.current - 1;

    // 循环模式开启，则重新播放当前模式下的相对的下一首
    if (this.repeatMode === 'on') {
      if (this._reversed && this.current === 0) {
        // 倒序模式，当前歌曲是最后一首，则重新播放列表第一首
        return [this.list[0], 0];
      } else if (this.list.length === this.current + 1) {
        // 正序模式，当前歌曲是第一首，则重新播放列表最后一首
        return [this.list[this.list.length - 1], this.list.length - 1];
      }
    }

    // 返回 [trackID, index]
    return [this.list[next], next];
  }
  async _shuffleTheList(firstTrackID = this.currentTrackID) {
    let list = this._list.filter(tid => tid !== firstTrackID);
    if (firstTrackID === 'first') list = this._list;
    this._shuffledList = shuffle(list);
    if (firstTrackID !== 'first') this._shuffledList.unshift(firstTrackID);
  }
  async _scrobble(track, time, completed = false) {
    console.debug(
      `[debug][Player.js] scrobble track 👉 ${track.name} by ${track.ar[0].name} 👉 time:${time} completed: ${completed}`
    );
    const trackDuration = ~~(track.dt / 1000);
    time = completed ? trackDuration : ~~time;
    scrobble({
      id: track.id,
      sourceid: this.playlistSource.id,
      time,
    });
    if (
      store.state.lastfm.key !== undefined &&
      (time >= trackDuration / 2 || time >= 240)
    ) {
      const timestamp = ~~(new Date().getTime() / 1000) - time;
      trackScrobble({
        artist: track.ar[0].name,
        track: track.name,
        timestamp,
        album: track.al?.name,
        trackNumber: track.no,
        duration: trackDuration,
      });
    }
  }
  _getAudioSourceBlobURL(data) {
    // Create a new object URL.
    const source = URL.createObjectURL(new Blob([data]));

    // Clean up the previous object URLs since we've created a new one.
    // Revoke object URLs can release the memory taken by a Blob,
    // which occupied a large proportion of memory.
    for (const url in this.createdBlobRecords) {
      URL.revokeObjectURL(url);
    }

    // Then, we replace the createBlobRecords with new one with
    // our newly created object URL.
    this.createdBlobRecords = [source];

    return source;
  }
  async _getAudioSourceFromCache(id) {
    let t = await getTrackSource(id);
    if (!t) return null;
    return this._getAudioSourceBlobURL(t.source);
  }
  async _getAudioSourceFromNetease(track) {
    if (isAccountLoggedIn()) {
      let result = await getMP3(track.id);
      if (!result.data[0]) return null;
      if (!result.data[0].url) return null;
      if (result.data[0].freeTrialInfo !== null) return null;
      const source = result.data[0].url.replace(/^http:/, 'https:');
      if (store.state.settings.automaticallyCacheSongs) {
        cacheTrackSource(track, source, result.data[0].br);
      }
      return source;
    } else {
      return null; // let's just query unblock if not logged in
    }
  }
  async _getAudioSourceFromGDStudio(track) {
    console.debug(`[debug][Player.js] _getAudioSourceFromGDStudio`);

    if (store.state.settings.enableUnblockNeteaseMusic === false) {
      return null;
    }

    // Credit: This API is provided by GD studio (music.gdstudio.xyz).
    try {
      const url =
        '/api/gdstudio?types=url&source=netease&id=' + track.id + '&br=320';
      const response = await fetch(url);
      const jsonBody = await response.json();
      if (jsonBody && typeof jsonBody === 'object' && !('url' in jsonBody)) {
        return null;
      }
      return jsonBody.br > 0 ? jsonBody.url : null;
    } catch (error) {
      console.error(error);
      return null;
    }
  }
  async _getAudioSourceFromYouTubeMusic(track) {
    console.debug(`[debug][Player.js] _getAudioSourceFromYouTubeMusic`);

    if (store.state.settings.enableUnblockNeteaseMusic === false) {
      return null;
    }

    const song = `${track.name || ''}`;
    const artists = track.ar ? track.ar.map(a => a.name).join(' ') : '';
    const album = `${track.al.name || ''}`;
    const query = store.state.settings.unmQueryFormat
      .replace('$song', song)
      .replace('$artists', artists)
      .replace('$album', album);
    const duration_tolerance = Number(
      store.state.settings.unmDurationTolerance
    );
    const dmin = Math.ceil(track.dt / 1000 - duration_tolerance);
    const dmax = Math.floor(track.dt / 1000 + duration_tolerance);
    let retrieveUrl;
    try {
      const response = await fetch(
        '/api/ytmurl?' +
          new URLSearchParams({
            q: query,
            dmin: dmin,
            dmax: dmax,
          })
      );
      if (response.status !== 200) {
        throw Error(`Got response.status = ${response.status}`);
      }
      retrieveUrl = await response.text();
      const source = retrieveUrl.replace(/^http:/, 'https:');
      if (store.state.settings.automaticallyCacheSongs) {
        cacheTrackSource(track, source, 'bestaudio', 'youtubemusic');
      }
      return retrieveUrl;
    } catch (err) {
      console.error(err);
      return null;
    }
  }
  async _getAudioSource(track) {
    let source = await this._getAudioSourceFromCache(String(track.id));
    if (!source) {
      source = await this._getAudioSourceFromNetease(track);
    }
    if (!source) {
      source = await this._getAudioSourceFromGDStudio(track);
    }
    if (!source) {
      source = await this._getAudioSourceFromYouTubeMusic(track);
    }
    return source;
  }
  async _replaceCurrentTrack(
    id,
    autoplay = true,
    ifUnplayableThen = UNPLAYABLE_CONDITION.PLAY_NEXT_TRACK
  ) {
    const trackSeqNum = ++this._trackSeqNum;
    audio.pause();
    this._progress = 0;
    this._state = PLAYER_STATE.LOADING_NEXT;
    this._enabled = true;
    if (this.playing && this._currentTrack.name) {
      this._scrobble(this.currentTrack, this.progress);
    }
    if (this._isPersonalFM) {
      id = await this._getNextFMTrack();
      if (!id) {
        return false;
      }
    }
    let data = await getTrackDetail(id);
    // If we started loading a newer track, abort this one
    if (trackSeqNum !== this._trackSeqNum) {
      return false;
    }
    const track = data.songs[0];
    this._currentTrack = track;
    if (this._cachedTrackId === track.id) {
      console.debug(`Swapping with cached track ${track.name}`);
      audio.removeEventListener('ended', this._audioEndedEventHandler);
      audio.pause();
      audio.src = null;
      [cacheAudio, audio] = [audio, cacheAudio];
      console.log(audio);
      this._currentTrackSource = this._cachedTrackSource;
      audio.addEventListener('ended', this._audioEndedEventHandler);
      this._state = PLAYER_STATE.IN_PROGRESS;
      if (autoplay || this.playing) {
        this.play();
      }
      this._cacheNextTrack();
      return true;
    }
    console.debug(`Getting track source for ${track.name}`);
    let source = await this._getAudioSource(track);
    if (source) {
      let replaced = false;
      if (track.id === this.currentTrackID) {
        this._currentTrackSource = source;
        audio.src = source;
        console.log(audio);
        this._state = PLAYER_STATE.IN_PROGRESS;
        if (autoplay || this.playing) {
          this.play();
        }
        replaced = true;
      }
      this._cacheNextTrack();
      return replaced;
    } else {
      store.dispatch('showToast', `无法播放 ${track.name}`);
      switch (ifUnplayableThen) {
        case UNPLAYABLE_CONDITION.PLAY_NEXT_TRACK:
          if (this.playing) {
            this.playNextTrack(false);
          } else {
            this._state = PLAYER_STATE.IN_PROGRESS;
          }
          break;
        case UNPLAYABLE_CONDITION.PLAY_PREV_TRACK:
          if (this.playing) {
            this.playPrevTrack(false);
          } else {
            this._state = PLAYER_STATE.IN_PROGRESS;
          }
          break;
        default:
          store.dispatch(
            'showToast',
            `undefined Unplayable condition: ${ifUnplayableThen}`
          );
          break;
      }
      return false;
    }
  }
  _cacheNextTrack() {
    let nextTrackID = this._isPersonalFM
      ? this._personalFMNextTrack?.id ?? 0
      : this._getNextTrack()[0];
    if (!nextTrackID) return;
    if (this._personalFMTrack.id === nextTrackID) return;
    getTrackDetail(nextTrackID).then(data => {
      let track = data.songs[0];
      this._getAudioSource(track).then(source => {
        cacheAudio.src = source;
        this._cachedTrackId = nextTrackID;
        this._cachedTrackSource = source;
        if (this._cacheAvailable) {
          cacheAudio.load();
        }
        console.debug(`Caching next track: ${track.name}`);
      });
    });
  }
  _loadSelfFromLocalStorage() {
    const player = JSON.parse(localStorage.getItem('player'));
    if (!player) return;
    for (const [key, value] of Object.entries(player)) {
      this[key] = value;
    }
  }
  _initMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        this.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('seekto', event => {
        if (event.fastSeek && 'fastSeek' in audio) {
          audio.fastSeek(event.seekTime);
        } else {
          this.seek(event.seekTime);
        }
      });
      // navigator.mediaSession.setActionHandler('seekbackward', event => {
      //   this.seek(this.seek() - (event.seekOffset || 10));
      // });
      // navigator.mediaSession.setActionHandler('seekforward', event => {
      //   this.seek(this.seek() + (event.seekOffset || 10));
      // });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        this.playPrevTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        this.playNextTrack();
      });
    }
  }
  _updateMediaSessionMetaData() {
    const track = this._currentTrack;
    if ('mediaSession' in navigator === false) {
      return;
    }
    let artists = track.ar.map(a => a.name);
    const metadata = {
      title: track.name,
      artist: artists.join(','),
      album: track.al?.name,
      artwork: [
        {
          src: track.al?.picUrl + '?param=224y224',
          type: 'image/jpg',
          sizes: '224x224',
        },
        {
          src: track.al?.picUrl + '?param=512y512',
          type: 'image/jpg',
          sizes: '512x512',
        },
      ],
      length: this.currentTrackDuration,
      trackId: this.current,
      url: '/trackid/' + track.id,
    };

    navigator.mediaSession.metadata = new window.MediaMetadata(metadata);

    this._updateMediaSessionPositionState();

    setTitle(this._currentTrack);
    setTrayLikeState(store.state.liked.songs.includes(this.currentTrack.id));

    if (isCreateMpris) {
      this._updateMprisState(track, metadata);
    }
  }
  // OSDLyrics 会检测 Mpris 状态并寻找对应歌词文件，所以要在更新 Mpris 状态之前保证歌词下载完成
  async _updateMprisState(track, metadata) {
    if (!store.state.settings.enableOsdlyricsSupport) {
      return ipcRenderer?.send('metadata', metadata);
    }

    let lyricContent = await getLyric(track.id);

    if (!lyricContent.lrc || !lyricContent.lrc.lyric) {
      return ipcRenderer?.send('metadata', metadata);
    }

    ipcRenderer.send('sendLyrics', {
      track,
      lyrics: lyricContent.lrc.lyric,
    });

    ipcRenderer.on('saveLyricFinished', () => {
      ipcRenderer?.send('metadata', metadata);
    });
  }
  _updateMediaSessionPositionState() {
    if ('mediaSession' in navigator === false) {
      return;
    }
    if ('setPositionState' in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({
        duration: ~~(this.currentTrack.dt / 1000),
        playbackRate: 1.0,
        position: audio.currentTime,
      });
    }
  }
  _nextTrackCallback() {
    this._scrobble(this._currentTrack, 0, true);
    if (!this.isPersonalFM && this.repeatMode === 'one') {
      this._replaceCurrentTrack(this.currentTrackID);
    } else {
      this.playNextTrack(false);
    }
  }
  _loadPersonalFMNextTrack() {
    if (this._personalFMNextLoading) {
      return [false, undefined];
    }
    this._personalFMNextLoading = true;
    return personalFM()
      .then(result => {
        if (!result || !result.data) {
          this._personalFMNextTrack = undefined;
        } else {
          this._personalFMNextTrack = result.data[0];
          this._cacheNextTrack(); // cache next track
        }
        this._personalFMNextLoading = false;
        return [true, this._personalFMNextTrack];
      })
      .catch(() => {
        this._personalFMNextTrack = undefined;
        this._personalFMNextLoading = false;
        return [false, this._personalFMNextTrack];
      });
  }
  _playDiscordPresence(track, seekTime = 0) {
    if (
      process.env.IS_ELECTRON !== true ||
      store.state.settings.enableDiscordRichPresence === false
    ) {
      return null;
    }
    let copyTrack = { ...track };
    copyTrack.dt -= seekTime * 1000;
    ipcRenderer?.send('playDiscordPresence', copyTrack);
  }
  _pauseDiscordPresence(track) {
    if (
      process.env.IS_ELECTRON !== true ||
      store.state.settings.enableDiscordRichPresence === false
    ) {
      return null;
    }
    ipcRenderer?.send('pauseDiscordPresence', track);
  }
  appendTrack(trackID) {
    this.list.append(trackID);
  }
  async playNextTrack(autoplay = true) {
    if (this._isPersonalFM) {
      return await this._replaceCurrentTrack(null, autoplay);
    } else {
      const [trackID, index, finished] = this._getNextTrack();
      if (finished) {
        this.playing = false;
      }
      let next = index;
      if (index === INDEX_IN_PLAY_NEXT) {
        this._playNextList.shift();
        next = this.current;
      }
      this.current = next;
      return await this._replaceCurrentTrack(trackID, autoplay);
    }
  }
  async _getNextFMTrack() {
    if (this._personalFMLoading) {
      return null;
    }

    this._isPersonalFM = true;
    if (!this._personalFMNextTrack) {
      this._personalFMLoading = true;
      let result = null;
      let retryCount = 5;
      for (; retryCount >= 0; retryCount--) {
        result = await personalFM().catch(() => null);
        if (!result) {
          this._personalFMLoading = false;
          store.dispatch('showToast', 'personal fm timeout');
          return null;
        }
        if (result.data?.length > 0) {
          break;
        } else if (retryCount > 0) {
          await delay(1000);
        }
      }
      this._personalFMLoading = false;

      if (retryCount < 0) {
        let content = '获取私人FM数据时重试次数过多，请手动切换下一首';
        store.dispatch('showToast', content);
        console.log(content);
        return null;
      }
      // 这里只能拿到一条数据
      this._personalFMTrack = result.data[0];
    } else {
      if (this._personalFMNextTrack.id === this._personalFMTrack.id) {
        return null;
      }
      this._personalFMTrack = this._personalFMNextTrack;
    }
    this._loadPersonalFMNextTrack();
    if (this._isPersonalFM) {
      return this._personalFMTrack.id;
    }
    return null;
  }
  playPrevTrack() {
    const [trackID, index] = this._getPrevTrack();
    if (trackID === undefined) return false;
    this.current = index;
    this._replaceCurrentTrack(
      trackID,
      true,
      UNPLAYABLE_CONDITION.PLAY_PREV_TRACK
    );
    return true;
  }
  saveSelfToLocalStorage() {
    let player = {};
    for (let [key, value] of Object.entries(this)) {
      if (excludeSaveKeys.includes(key)) continue;
      player[key] = value;
    }

    localStorage.setItem('player', JSON.stringify(player));
  }

  pause() {
    this.playing = false;
    audio.pause();
    navigator.mediaSession.playbackState = 'paused';
    this._pauseDiscordPresence(this._currentTrack);
  }
  play() {
    this.playing = true;
    if (this._state == PLAYER_STATE.IN_PROGRESS) {
      let trackSeqNum = this._trackSeqNum;
      this._state = PLAYER_STATE.LOADING_CURRENT;
      audio
        .play()
        .then(() => {
          this._state = PLAYER_STATE.IN_PROGRESS;
          this._initMediaSession();
          this._updateMediaSessionMetaData();
        })
        .catch(async error => {
          console.error(error);
          if (trackSeqNum === this._trackSeqNum && this.playing) {
            store.dispatch('showToast', `Error ${audio.error?.code}`);
            this.playNextTrack(false);
          }
        });
      // 播放时确保开启player.
      // 避免因"忘记设置"导致在播放时播放器不显示的Bug
    }
    this._enabled = true;
    this._playDiscordPresence(this._currentTrack, this.seek());
    if (store.state.lastfm.key !== undefined) {
      trackUpdateNowPlaying({
        artist: this.currentTrack.ar[0].name,
        track: this.currentTrack.name,
        album: this.currentTrack.al?.name,
        trackNumber: this.currentTrack.no,
        duration: ~~(this.currentTrack.dt / 1000),
      });
    }
  }
  playOrPause() {
    if (this.playing) {
      this.pause();
    } else {
      this.play();
    }
  }
  seek(time = null, sendMpris = true) {
    if (isCreateMpris && sendMpris && time) {
      ipcRenderer?.send('seeked', time);
    }
    if (time !== null && audio.duration) {
      audio.currentTime = Math.max(0, Math.min(time, audio.duration));
      this._progress = audio.currentTime;
      this._updateMediaSessionPositionState();
      if (this.playing)
        this._playDiscordPresence(this._currentTrack, this.seek(null, false));
    }
    return this._progress;
  }
  mute() {
    if (this.volume === 0) {
      this.volume = this._volumeBeforeMuted;
    } else {
      this._volumeBeforeMuted = this.volume;
      this.volume = 0;
    }
  }
  setOutputDevice() {}

  replacePlaylist(
    trackIDs,
    playlistSourceID,
    playlistSourceType,
    autoPlayTrackID = 'first'
  ) {
    this._isPersonalFM = false;
    this.list = trackIDs;
    this.current = 0;
    this._playlistSource = {
      type: playlistSourceType,
      id: playlistSourceID,
    };
    if (this.shuffle) this._shuffleTheList(autoPlayTrackID);
    if (autoPlayTrackID === 'first') {
      this._replaceCurrentTrack(this.list[0]);
    } else {
      this.current = trackIDs.indexOf(autoPlayTrackID);
      this._replaceCurrentTrack(autoPlayTrackID);
    }
  }
  playAlbumByID(id, trackID = 'first') {
    getAlbum(id).then(data => {
      let trackIDs = data.songs.map(t => t.id);
      this.replacePlaylist(trackIDs, id, 'album', trackID);
    });
  }
  playPlaylistByID(id, trackID = 'first', noCache = false) {
    console.debug(
      `[debug][Player.js] playPlaylistByID 👉 id:${id} trackID:${trackID} noCache:${noCache}`
    );
    getPlaylistDetail(id, noCache).then(data => {
      let trackIDs = data.playlist.trackIds.map(t => t.id);
      this.replacePlaylist(trackIDs, id, 'playlist', trackID);
    });
  }
  playArtistByID(id, trackID = 'first') {
    getArtist(id).then(data => {
      let trackIDs = data.hotSongs.map(t => t.id);
      this.replacePlaylist(trackIDs, id, 'artist', trackID);
    });
  }
  playTrackOnListByID(id, listName = 'default') {
    if (listName === 'default') {
      this._current = this._list.findIndex(t => t === id);
    }
    this._replaceCurrentTrack(id);
  }
  playIntelligenceListById(id, trackID = 'first', noCache = false) {
    getPlaylistDetail(id, noCache).then(data => {
      const randomId = Math.floor(
        Math.random() * (data.playlist.trackIds.length + 1)
      );
      const songId = data.playlist.trackIds[randomId].id;
      intelligencePlaylist({ id: songId, pid: id }).then(result => {
        let trackIDs = result.data.map(t => t.id);
        this.replacePlaylist(trackIDs, id, 'playlist', trackID);
      });
    });
  }
  addTrackToPlayNext(trackID, playNow = false) {
    this._playNextList.push(trackID);
    if (playNow) {
      this.playNextTrack();
    }
  }
  playPersonalFM() {
    this._isPersonalFM = true;
    if (this.currentTrackID !== this._personalFMTrack.id) {
      this._replaceCurrentTrack(this._personalFMTrack.id, true);
    } else {
      this.playOrPause();
    }
  }
  async moveToFMTrash() {
    this._isPersonalFM = true;
    let id = this._personalFMTrack.id;
    if (await this.playNextTrack()) {
      fmTrash(id);
    }
  }

  sendSelfToIpcMain() {
    if (process.env.IS_ELECTRON !== true) return false;
    let liked = store.state.liked.songs.includes(this.currentTrack.id);
    ipcRenderer?.send('player', {
      playing: this.playing,
      likedCurrentTrack: liked,
    });
    setTrayLikeState(liked);
  }

  switchRepeatMode() {
    if (this._repeatMode === 'on') {
      this.repeatMode = 'one';
    } else if (this._repeatMode === 'one') {
      this.repeatMode = 'off';
    } else {
      this.repeatMode = 'on';
    }
    if (isCreateMpris) {
      ipcRenderer?.send('switchRepeatMode', this.repeatMode);
    }
  }
  switchShuffle() {
    this.shuffle = !this.shuffle;
    if (isCreateMpris) {
      ipcRenderer?.send('switchShuffle', this.shuffle);
    }
  }
  switchReversed() {
    this.reversed = !this.reversed;
  }

  clearPlayNextList() {
    this._playNextList = [];
  }
  removeTrackFromQueue(index) {
    this._playNextList.splice(index, 1);
  }
}
