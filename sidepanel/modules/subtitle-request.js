function staleSubtitleError(message) {
  const error = new Error(message);
  error.code = "STALE_SUBTITLE_REQUEST";
  return error;
}

export function isStaleSubtitleError(error) {
  return error && error.code === "STALE_SUBTITLE_REQUEST";
}

export class SubtitleRequestCoordinator {
  constructor(loader) {
    this.loader = loader;
    this.generation = 0;
    this.pending = null;
  }

  invalidate() {
    this.generation += 1;
    this.pending = null;
  }

  load(videoId, trackIndex) {
    if (!videoId) return Promise.reject(new Error("缺少当前视频标识"));

    const key = `${videoId}:${Number.isInteger(trackIndex) ? trackIndex : "auto"}`;
    if (this.pending && this.pending.key === key) return this.pending.promise;

    const generation = this.generation;
    let source;
    try {
      source = this.loader(trackIndex, videoId);
    } catch (error) {
      source = Promise.reject(error);
    }

    const promise = Promise.resolve(source)
      .then((response) => {
        if (generation !== this.generation) {
          throw staleSubtitleError("已丢弃过期字幕响应");
        }
        if (!response || response.videoId !== videoId) {
          throw staleSubtitleError("字幕响应与当前视频不一致");
        }
        return response;
      })
      .finally(() => {
        if (this.pending && this.pending.promise === promise) this.pending = null;
      });

    this.pending = { key, promise };
    return promise;
  }
}
