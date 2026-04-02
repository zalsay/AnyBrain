interface GeneralSettingsTabProps {
  speechRate: number;
  onSpeechRateChange: (value: number) => void;
  useSystemProxy: boolean;
  onToggleSystemProxy: () => void;
}

function GeneralSettingsTab(props: GeneralSettingsTabProps) {
  return (
    <div className="panel-list">
      <div className="panel-section-block panel-section-block-settings">
        <div className="panel-section-header panel-section-header-grouped">
          <div>
            <div className="panel-section-title">通用</div>
            <div className="panel-section-caption">管理语音朗读和网络代理等全局行为。</div>
          </div>
          <span className="panel-section-count">2</span>
        </div>

        <div className="panel-section-stack">
          <div className="panel-setting-item panel-setting-item-highlight">
            <div className="panel-setting-main">
              <span className="panel-setting-label">语音朗读速度</span>
              <span className="panel-setting-hint">调整内置语音播报的语速，修改后会立即生效。</span>
            </div>
            <div className="panel-setting-control panel-setting-control-rate">
              <input
                className="panel-range"
                type="range"
                min={0.7}
                max={1.3}
                step={0.05}
                value={props.speechRate}
                onChange={event => props.onSpeechRateChange(Number.parseFloat(event.target.value))}
              />
              <input
                className="panel-number"
                type="number"
                min={0.7}
                max={1.3}
                step={0.05}
                value={props.speechRate}
                onChange={event => {
                  const nextRate = Number.parseFloat(event.target.value || '0');
                  if (Number.isNaN(nextRate)) return;
                  props.onSpeechRateChange(Math.min(1.3, Math.max(0.7, nextRate)));
                }}
              />
            </div>
          </div>

          <div className="panel-setting-item panel-setting-item-highlight">
            <div className="panel-setting-main">
              <span className="panel-setting-label">使用系统代理</span>
              <span className="panel-setting-hint">开启后，应用内网络请求将优先跟随系统代理配置。</span>
            </div>
            <button
              className={`toggle-switch panel-setting-toggle-switch ${props.useSystemProxy ? 'active' : ''}`}
              onClick={props.onToggleSystemProxy}
              role="switch"
              aria-checked={props.useSystemProxy}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GeneralSettingsTab;
