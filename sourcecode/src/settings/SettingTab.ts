import { App, PluginSettingTab, Setting, setIcon, Notice } from 'obsidian';
import RedPlugin from '../main'; // 修改插件名以匹配类名
import { CreateThemeModal } from './CreateThemeModal';
import { CreateFontModal } from './CreateFontModal';
import { ConfirmModal } from './ConfirmModal'; // 添加确认模态框导入
import { ThemePreviewModal } from './ThemePreviewModal'; // 新增导入
import { VIEW_TYPE_RED } from '../view';
import { CoverGenerator } from '../coverGenerator';

export class RedSettingTab extends PluginSettingTab {
    plugin: RedPlugin; // 修改插件类型以匹配类名
    private expandedSections: Set<string> = new Set();

    constructor(app: App, plugin: RedPlugin) { // 修改插件类型以匹配类名
        super(app, plugin);
        this.plugin = plugin;
    }

    private createSection(containerEl: HTMLElement, title: string, renderContent: (contentEl: HTMLElement) => void) {
        const section = containerEl.createDiv('settings-section');
        const header = section.createDiv('settings-section-header');
        
        const toggle = header.createSpan('settings-section-toggle');
        setIcon(toggle, 'chevron-right');
        
        header.createEl('h4', { text: title });
        
        const content = section.createDiv('settings-section-content');
        renderContent(content);
        
        header.addEventListener('click', () => {
            const isExpanded = !section.hasClass('is-expanded');
            section.toggleClass('is-expanded', isExpanded);
            setIcon(toggle, isExpanded ? 'chevron-down' : 'chevron-right');
            if (isExpanded) {
                this.expandedSections.add(title);
            } else {
                this.expandedSections.delete(title);
            }
        });
        
        if (this.expandedSections.has(title) || (!containerEl.querySelector('.settings-section'))) {
            section.addClass('is-expanded');
            setIcon(toggle, 'chevron-down');
            this.expandedSections.add(title);
        }
        
        return section;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('red-settings');

        containerEl.createEl('h2', { text: '⚙ Note2Red 设置' });

        this.createSection(containerEl, '📄 基本设置', el => this.renderBasicSettings(el));
        this.createSection(containerEl, '🎨 主题设置', el => this.renderThemeSettings(el));
        this.createSection(containerEl, '🤖 封面与 AI 生图', el => this.renderCoverSettings(el));
    }

    private async refreshActiveViews() {
        const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_RED);
        for (const leaf of leaves) {
            const view = leaf.view as any;
            if (view && typeof view.updatePreview === 'function') {
                if (typeof view.syncChromeToggleButtons === 'function') {
                    view.syncChromeToggleButtons();
                }
                await view.updatePreview();
            }
        }
    }

    private async ensureFolderRecursive(folderPath: string) {
        const parts = folderPath.split('/').filter(Boolean);
        let cur = '';
        for (const part of parts) {
            cur = cur ? `${cur}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(cur)) {
                try {
                    await this.app.vault.createFolder(cur);
                } catch (_e) {}
            }
        }
    }

    private renderCoverSettings(containerEl: HTMLElement): void {
        const settings = () => this.plugin.settingsManager.getSettings();

        new Setting(containerEl)
            .setName('启用第一页封面')
            .setDesc('封面布局：上方约 62% 插图，下方文件名作为标题。开启后第一张为封面，后续为正文分页。')
            .addToggle(toggle => toggle
                .setValue(settings().coverEnabled === true)
                .onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ coverEnabled: value });
                    await this.refreshActiveViews();
                })
            );

        new Setting(containerEl)
            .setName('封面排版风格')
            .setDesc('两种封面排版：标题在下，或标题在上。')
            .addDropdown(dropdown => dropdown
                .addOption('image-top', '标题在下：图片在上 + 标题在下')
                .addOption('title-top', '标题在上：标题在上 + 图片在中 + 摘要在下')
                .setValue(settings().coverLayout || 'image-top')
                .onChange(async (value: 'image-top' | 'title-top') => {
                    await this.plugin.settingsManager.updateSettings({ coverLayout: value });
                    await this.refreshActiveViews();
                })
            );

        new Setting(containerEl)
            .setName('显示封面摘要')
            .setDesc('仅在“标题在上”模式下生效；摘要也可以在封面预览区直接点击编辑。')
            .addToggle(toggle => toggle
                .setValue(settings().coverShowExcerpt !== false)
                .onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ coverShowExcerpt: value });
                    await this.refreshActiveViews();
                })
            );

        new Setting(containerEl)
            .setName('封面标题字体')
            .setDesc('留空则跟随正文；示例：SimSun, 宋体, serif')
            .addText(text => {
                text.setPlaceholder('留空跟随正文字体');
                text.setValue(settings().coverTitleFont || '');
                text.onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ coverTitleFont: value.trim() });
                    await this.refreshActiveViews();
                });
            });

        new Setting(containerEl)
            .setName('AI 接口')
            .setDesc('选择生成封面使用的 AI 服务')
            .addDropdown(dropdown => dropdown
                .addOption('gemini', 'Google Gemini')
                .addOption('openai', 'OpenAI / 兼容接口')
                .addOption('volcengine', '火山引擎 (豆包/即梦)')
                .setValue(settings().coverApiProvider || 'gemini')
                .onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ coverApiProvider: value as 'gemini' | 'openai' | 'volcengine' });
                    this.display();
                })
            );

        const provider = settings().coverApiProvider || 'gemini';
        const keyDescs: Record<string, string> = {
            gemini: 'Google AI Studio 申请。密钥请勿泄露。',
            openai: 'OpenAI 或兼容服务的 API Key，如 sk-...',
            volcengine: '火山引擎 Ark API Key。在火山引擎控制台获取。'
        };
        const keyPlaceholders: Record<string, string> = {
            gemini: 'AIza...',
            openai: 'sk-...',
            volcengine: '请输入火山引擎 API Key'
        };
        const modelDescs: Record<string, string> = {
            gemini: '默认 gemini-2.5-flash-image',
            openai: '如 dall-e-3, dall-e-2',
            volcengine: '如 doubao-seedream-3-0-t2i-250415'
        };
        const modelPlaceholders: Record<string, string> = {
            gemini: 'gemini-2.5-flash-image',
            openai: 'dall-e-3',
            volcengine: 'doubao-seedream-3-0-t2i-250415'
        };

        new Setting(containerEl)
            .setName('API Key')
            .setDesc(keyDescs[provider] || keyDescs.gemini)
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder(keyPlaceholders[provider] || '');
                text.setValue(settings().geminiApiKey || '');
                text.onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ geminiApiKey: value.trim() });
                });
            });

        if (provider === 'openai' || provider === 'volcengine') {
            const epDefaults: Record<string, string> = {
                openai: 'https://api.openai.com/v1/images/generations',
                volcengine: 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
            };
            new Setting(containerEl)
                .setName('API 端点')
                .setDesc(provider === 'volcengine' ? '火山引擎图片生成端点，默认北京region。' : 'OpenAI 兼容的图片生成端点。')
                .addText(text => {
                    text.setPlaceholder(epDefaults[provider] || '');
                    text.setValue(settings().coverApiEndpoint || '');
                    text.onChange(async value => {
                        await this.plugin.settingsManager.updateSettings({ coverApiEndpoint: value.trim() });
                    });
                });
        }

        new Setting(containerEl)
            .setName('生图模型 ID')
            .setDesc(modelDescs[provider] || modelDescs.gemini)
            .addText(text => {
                text.setPlaceholder(modelPlaceholders[provider] || '');
                text.setValue(settings().geminiImageModel || '');
                text.onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ geminiImageModel: value.trim() });
                });
            });

        new Setting(containerEl)
            .setName('封面存储文件夹')
            .setDesc('AI 生成与手动上传的封面图都会存到这个库内相对路径。默认 99_attachments/note-to-red-covers。')
            .addText(text => {
                text.setPlaceholder('99_attachments/note-to-red-covers');
                text.setValue(settings().coverSaveFolder || '');
                text.onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ coverSaveFolder: value.trim() });
                });
            });

        new Setting(containerEl)
            .setName('手动封面图路径')
            .setDesc('填入库内相对路径时优先于 AI 生成图。留空则使用生成图或占位。')
            .addText(text => {
                text.setValue(settings().coverManualImagePath || '');
                text.onChange(async value => {
                    await this.plugin.settingsManager.updateSettings({ coverManualImagePath: value.trim() });
                    await this.refreshActiveViews();
                });
            })
            .addButton(button => button
                .setButtonText('从本机选图并存入库')
                .onClick(async () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async () => {
                        const file = input.files?.[0];
                        if (!file) return;
                        const buffer = await file.arrayBuffer();
                        const folder = (settings().coverSaveFolder || '99_attachments/note-to-red-covers').replace(/\/+$/, '');
                        await this.ensureFolderRecursive(folder);
                        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                        const outPath = `${folder}/manual-upload-${Date.now()}-${safe}`;
                        await this.app.vault.createBinary(outPath, buffer);
                        await this.plugin.settingsManager.updateSettings({ coverManualImagePath: outPath });
                        new Notice(`已保存：${outPath}`);
                        this.display();
                        await this.refreshActiveViews();
                    };
                    input.click();
                })
            )
            .addButton(button => button
                .setButtonText('清空')
                .onClick(async () => {
                    await this.plugin.settingsManager.updateSettings({ coverManualImagePath: '' });
                    this.display();
                    await this.refreshActiveViews();
                })
            );

        const presetKey = settings().coverPromptPreset || 'notion';
        const presetLabels: Record<string, string> = { notion: 'Notion 插画风' };
        const currentCustom = settings().coverPromptCustom || '';
        const currentPresetText = CoverGenerator.PROMPT_PRESETS[presetKey] || CoverGenerator.PROMPT_PRESETS.notion;
        const promptSetting = new Setting(containerEl)
            .setName('封面提示词')
            .setDesc('编辑生成封面图的提示词。可使用 {标题} 和 {摘要} 作为占位符。');

        const promptStatusEl = document.createElement('span');
        promptStatusEl.style.cssText = 'font-size: 12px; padding: 2px 8px; border-radius: 4px; margin-left: 8px;';
        const updateStatusBadge = (custom: string) => {
            const presetText = CoverGenerator.PROMPT_PRESETS[settings().coverPromptPreset || 'notion'] || '';
            const modified = custom.trim() !== '' && custom.trim() !== presetText.trim();
            if (modified) {
                promptStatusEl.textContent = '• 已自定义';
                promptStatusEl.style.color = '#e67e22';
                promptStatusEl.style.background = 'rgba(230,126,34,0.1)';
            } else {
                promptStatusEl.textContent = '○ 默认预设';
                promptStatusEl.style.color = 'var(--text-muted)';
                promptStatusEl.style.background = 'var(--background-modifier-hover)';
            }
        };
        updateStatusBadge(currentCustom);
        promptSetting.nameEl.appendChild(promptStatusEl);

        const textarea = document.createElement('textarea');
        textarea.className = 'red-prompt-textarea';
        textarea.rows = 10;
        textarea.value = currentCustom.trim() ? currentCustom : currentPresetText;
        textarea.style.cssText = 'width: 100%; min-height: 150px; font-size: 13px; line-height: 1.5; resize: vertical; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); color: var(--text-normal); font-family: inherit;';
        promptSetting.settingEl.appendChild(textarea);
        promptSetting.settingEl.style.flexWrap = 'wrap';

        const row = document.createElement('div');
        row.style.cssText = 'width: 100%; display: flex; gap: 8px; margin-top: 6px; align-items: center;';
        const save = document.createElement('button');
        save.textContent = '保存提示词';
        save.className = 'mod-cta';
        save.style.fontSize = '12px';
        save.addEventListener('click', async () => {
            await this.plugin.settingsManager.updateSettings({ coverPromptCustom: textarea.value });
            updateStatusBadge(textarea.value);
            new Notice('提示词已保存');
        });
        const restore = document.createElement('button');
        restore.textContent = '恢复默认';
        restore.style.fontSize = '12px';
        restore.addEventListener('click', async () => {
            textarea.value = CoverGenerator.PROMPT_PRESETS[settings().coverPromptPreset || 'notion'] || CoverGenerator.PROMPT_PRESETS.notion;
            await this.plugin.settingsManager.updateSettings({ coverPromptCustom: '' });
            updateStatusBadge('');
            new Notice('已恢复默认预设提示词');
        });
        const presetSelectLabel = document.createElement('span');
        presetSelectLabel.textContent = '预设：';
        presetSelectLabel.style.cssText = 'font-size: 12px; color: var(--text-muted); margin-left: auto;';
        const presetSelect = document.createElement('select');
        presetSelect.style.cssText = 'font-size: 12px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal);';
        for (const key of Object.keys(CoverGenerator.PROMPT_PRESETS)) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = presetLabels[key] || key;
            presetSelect.appendChild(opt);
        }
        presetSelect.value = presetKey;
        presetSelect.addEventListener('change', async () => {
            await this.plugin.settingsManager.updateSettings({ coverPromptPreset: presetSelect.value });
        });
        row.appendChild(save);
        row.appendChild(restore);
        row.appendChild(presetSelectLabel);
        row.appendChild(presetSelect);
        promptSetting.settingEl.appendChild(row);
    }

    private renderBasicSettings(containerEl: HTMLElement): void {
        // 使用说明
        const tip = containerEl.createDiv('red-settings-tip');
        tip.createSpan({ text: '💡 按页面高度自动分页；手动换页在正文中插入 --- 分隔线即可。' });

        // 笔记下边距调节
        const settings = () => this.plugin.settingsManager.getSettings();
        const marginSetting = new Setting(containerEl)
            .setName('笔记下边距')
            .setDesc('调整内容区域底部的留白空间，数值越大底部空白越多');

        const marginValueEl = document.createElement('span');
        marginValueEl.style.cssText = 'min-width: 36px; text-align: center; font-weight: 600; font-size: 14px;';
        marginValueEl.textContent = `${settings().contentBottomMargin ?? 0}px`;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '60';
        slider.step = '2';
        slider.value = String(settings().contentBottomMargin ?? 0);
        slider.style.cssText = 'flex: 1; margin: 0 8px;';
        slider.addEventListener('input', () => {
            marginValueEl.textContent = `${slider.value}px`;
        });
        slider.addEventListener('change', async () => {
            const val = parseInt(slider.value, 10);
            await this.plugin.settingsManager.updateSettings({ contentBottomMargin: val });
            await this.refreshActiveViews();
        });

        marginSetting.settingEl.appendChild(slider);
        marginSetting.settingEl.appendChild(marginValueEl);

        // 图片宽度调节
        const imgWidthSetting = new Setting(containerEl)
            .setName('图片宽度')
            .setDesc('调整图片最大宽度占页面宽度的百分比。100% 为刚好不超出页宽');

        const imgWidthValueEl = document.createElement('span');
        imgWidthValueEl.style.cssText = 'min-width: 36px; text-align: center; font-weight: 600; font-size: 14px;';
        imgWidthValueEl.textContent = `${settings().imageWidthPercent ?? 100}%`;

        const imgWidthSlider = document.createElement('input');
        imgWidthSlider.type = 'range';
        imgWidthSlider.min = '50';
        imgWidthSlider.max = '100';
        imgWidthSlider.step = '5';
        imgWidthSlider.value = String(settings().imageWidthPercent ?? 100);
        imgWidthSlider.style.cssText = 'flex: 1; margin: 0 8px;';
        imgWidthSlider.addEventListener('input', () => {
            imgWidthValueEl.textContent = `${imgWidthSlider.value}%`;
        });
        imgWidthSlider.addEventListener('change', async () => {
            const val = parseInt(imgWidthSlider.value, 10);
            await this.plugin.settingsManager.updateSettings({ imageWidthPercent: val });
            await this.refreshActiveViews();
        });

        imgWidthSetting.settingEl.appendChild(imgWidthSlider);
        imgWidthSetting.settingEl.appendChild(imgWidthValueEl);

        // 字体管理区域
        const fontSection = containerEl.createDiv('red-settings-subsection');
        const fontHeader = fontSection.createDiv('red-settings-subsection-header');
        const fontToggle = fontHeader.createSpan('red-settings-subsection-toggle');
        setIcon(fontToggle, 'chevron-right');
        fontHeader.createEl('h3', { text: '🔤 字体管理' });
        const fontContent = fontSection.createDiv('red-settings-subsection-content');

        fontHeader.addEventListener('click', () => {
            const isExpanded = !fontSection.hasClass('is-expanded');
            fontSection.toggleClass('is-expanded', isExpanded);
            setIcon(fontToggle, isExpanded ? 'chevron-down' : 'chevron-right');
        });

        // 字体列表
        const fontList = fontContent.createDiv('red-setting-list');
        const fonts = this.plugin.settingsManager.getFontOptions();
        fonts.filter(f => f.isPreset).forEach(font => {
            fontList.createDiv('red-setting-list-item red-setting-list-item--preset').createSpan({ text: `${font.label}（${font.value}）` });
        });
        fonts.filter(f => !f.isPreset).forEach(font => {
            const row = fontList.createDiv('red-setting-list-item');
            row.createSpan({ text: `${font.label}（${font.value}）` });
            const actions = row.createDiv('red-setting-list-actions');
            const editBtn = actions.createEl('button', { cls: 'red-setting-btn-icon', attr: { 'aria-label': '编辑' } });
            setIcon(editBtn, 'pencil');
            editBtn.addEventListener('click', () => {
                new CreateFontModal(this.app, async (updatedFont) => {
                    await this.plugin.settingsManager.updateFont(font.value, updatedFont);
                    this.display();
                }, font).open();
            });
            const delBtn = actions.createEl('button', { cls: 'red-setting-btn-icon', attr: { 'aria-label': '删除' } });
            setIcon(delBtn, 'trash');
            delBtn.addEventListener('click', () => {
                new ConfirmModal(this.app, '确认删除字体', `确定要删除「${font.label}」吗？`, async () => {
                    await this.plugin.settingsManager.removeFont(font.value);
                    this.display();
                }).open();
            });
        });

        new Setting(fontContent)
            .setClass('red-setting-add-btn')
            .addButton(btn => btn.setButtonText('+ 添加字体').setCta().onClick(() => {
                new CreateFontModal(this.app, async (newFont) => {
                    await this.plugin.settingsManager.addCustomFont(newFont);
                    this.display();
                }).open();
            }));
    }

    private renderThemeSettings(containerEl: HTMLElement): void {
        const settings = () => this.plugin.settingsManager.getSettings();

        const refreshActiveViews = async () => {
            const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_RED);
            for (const leaf of leaves) {
                const view = leaf.view as any;
                if (view && typeof view.updatePreview === 'function') {
                    if (typeof view.syncChromeToggleButtons === 'function') view.syncChromeToggleButtons();
                    await view.updatePreview();
                }
            }
        };

        // -- 显示设置 --
        const visibilitySection = containerEl.createDiv('red-settings-subsection');
        const visHeader = visibilitySection.createDiv('red-settings-subsection-header');
        const visToggle = visHeader.createSpan('red-settings-subsection-toggle');
        setIcon(visToggle, 'chevron-right');
        visHeader.createEl('h3', { text: '👁 显示设置' });
        const visContent = visibilitySection.createDiv('red-settings-subsection-content');
        visHeader.addEventListener('click', () => {
            const open = !visibilitySection.hasClass('is-expanded');
            visibilitySection.toggleClass('is-expanded', open);
            setIcon(visToggle, open ? 'chevron-down' : 'chevron-right');
        });

        const addToggle = (name: string, desc: string, get: () => boolean, set: (v: boolean) => Promise<void>) => {
            new Setting(visContent).setName(name).setDesc(desc).addToggle(t => t.setValue(get()).onChange(set));
        };

        addToggle('显示页眉（头像和用户信息）', '关闭后文字区域会自动扩大',
            () => settings().showHeader === true,
            async (v) => { await this.plugin.settingsManager.updateSettings({ showHeader: v }); await refreshActiveViews(); });
        addToggle('显示时间', '需先开启页眉；时间显示在用户信息右侧',
            () => settings().showTime !== false,
            async (v) => { await this.plugin.settingsManager.updateSettings({ showTime: v }); await refreshActiveViews(); });
        addToggle('显示页脚', '控制是否在主题中显示页脚部分',
            () => settings().showFooter !== false,
            async (v) => { await this.plugin.settingsManager.updateSettings({ showFooter: v }); await refreshActiveViews(); });

        new Setting(visContent).setName('自定义时间').setDesc('填后替换当天日期；留空自动显示当天')
            .addText(text => text.setPlaceholder('如：2025年6月19日').setValue(settings().customTime || '')
                .onChange(async v => { await this.plugin.settingsManager.updateSettings({ customTime: v.trim() }); await refreshActiveViews(); }));
        new Setting(visContent).setName('全局文字颜色').setDesc('留空跟随主题；填写后对所有文字生效')
            .addText(text => text.setPlaceholder('#333333').setValue(settings().textColor || '')
                .onChange(async v => { await this.plugin.settingsManager.updateSettings({ textColor: v.trim() }); await refreshActiveViews(); }))
            .addButton(btn => btn.setButtonText('清空').onClick(async () => { await this.plugin.settingsManager.updateSettings({ textColor: '' }); await refreshActiveViews(); this.display(); }));

        visContent.createEl('hr', { cls: 'red-settings-divider' });

        // -- 主题可见性 --
        visContent.createEl('h4', { text: '主题可见性', cls: 'red-setting-group-title' });
        const allThemes = this.plugin.settingsManager.getAllThemes();
        const toggleList = visContent.createDiv('red-setting-list');
        allThemes.forEach(theme => {
            const row = toggleList.createDiv('red-setting-list-item');
            const info = row.createDiv('red-setting-list-info');
            info.createSpan({ text: theme.name });
            if (theme.isPreset) info.createSpan({ text: '内置', cls: 'red-setting-badge' });
            new Setting(row).setClass('red-setting-list-toggle').addToggle(t => t.setValue(theme.isVisible !== false)
                .onChange(async v => { theme.isVisible = v; await this.plugin.settingsManager.updateTheme(theme.id, theme); }));
        });

        // -- 自定义主题管理 --
        const customThemes = allThemes.filter(t => !t.isPreset);
        if (customThemes.length > 0) {
            containerEl.createEl('hr', { cls: 'red-settings-divider' });
            containerEl.createEl('h4', { text: '🎨 自定义主题', cls: 'red-setting-group-title' });
            const themeList = containerEl.createDiv('red-setting-list');
            customThemes.forEach(theme => {
                const row = themeList.createDiv('red-setting-list-item');
                row.createDiv('red-setting-list-info').createSpan({ text: theme.name });
                const actions = row.createDiv('red-setting-list-actions');
                [['eye', '预览', () => new ThemePreviewModal(this.app, this.plugin.settingsManager, theme, this.plugin.themeManager).open()],
                 ['pencil', '编辑', () => new CreateThemeModal(this.app, this.plugin, (ut) => { this.plugin.settingsManager.updateTheme(theme.id, ut); this.display(); }, theme).open()],
                 ['trash', '删除', () => new ConfirmModal(this.app, '确认删除', `确定要删除「${theme.name}」吗？`, async () => { await this.plugin.settingsManager.removeTheme(theme.id); this.display(); }).open()]
                ].forEach(([icon, tooltip, handler]) => {
                    const btn = actions.createEl('button', { cls: 'red-setting-btn-icon', attr: { 'aria-label': tooltip as string } });
                    setIcon(btn, icon as string);
                    btn.addEventListener('click', handler as () => void);
                });
            });
        }

        new Setting(containerEl).setClass('red-setting-add-btn').addButton(btn => btn.setButtonText('+ 新建主题').setCta().onClick(() => {
            new CreateThemeModal(this.app, this.plugin, async (nt) => { await this.plugin.settingsManager.addCustomTheme(nt); this.display(); }).open();
        }));
    }
}
