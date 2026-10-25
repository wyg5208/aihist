
> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimaxi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 概览

> MiniMax 模型体系涵盖语言、视频、语音、图像与音乐五大方向，助力开发者高效构建智能应用。

### 语言模型

<Note>MiniMax-M3.1-Flash-Preview 暂时仅通过 M Plan 和 MiniMax Code 提供。</Note>

| **模型名称**             | **介绍**                                                         |
| :- | :- |
| <a href="/docs/api-reference/text-anthropic-api" style={{whiteSpace:"nowrap"}}>MiniMax-M3.1-Flash-Preview</a> | 原生多模态、1M 上下文的 Frontier Coding 模型，思考深度可调 |
| [MiniMax-M3](/docs/api-reference/text-anthropic-api) | 原生多模态、1M 上下文的 Frontier Coding 模型 |
| [MiniMax-M2.7](/docs/api-reference/text-anthropic-api) | 开启模型的自我迭代 |
| [MiniMax-M2.7-highspeed](/docs/api-reference/text-anthropic-api) | 与 M2.7 效果不变，速度大幅提升 |

<Accordion title="历史模型">
  | **模型名称**             | **介绍**                                                         |
  | :- | :- |
  | [MiniMax-M2.5](/docs/api-reference/text-anthropic-api) | 顶尖性能与极致性价比，轻松驾驭复杂任务 |
  | [MiniMax-M2.5-highspeed](/docs/api-reference/text-anthropic-api) | 与 M2.5 效果不变，速度大幅提升 |
  | [MiniMax-M2.1](/docs/api-reference/text-anthropic-api) | 强大多语言编程能力，全面升级代码工程体验 |
  | [MiniMax-M2.1-highspeed](/docs/api-reference/text-anthropic-api) | 与 M2.1 效果不变，速度大幅提升 |
  | [MiniMax-M2](/docs/api-reference/text-anthropic-api) | 专为高效编码与Agent工作流而生 |
</Accordion>

### 视频模型

| **模型名称**             | **介绍** |
| :- | :- |
| [MiniMax H3](/docs/api-reference/video-generation-v2-create) | 新一代开放通用多模态视频模型，支持文生 / 图生 / 首尾帧 / 多模态参考，768P / 2K 分辨率，4–15s 时长 |
| [MiniMax H3 Max](/docs/api-reference/video-generation-v2-create) | 由 [fal.ai](https://fal.ai/) 基于 MiniMax H3 后训练的极速视频生成模型，专为高速视频生成而优化。仅支持文生 / 图生（首帧、尾帧），480P / 768P 分辨率，5–15s 时长 |

<Accordion title="历史模型">
  | **模型名称**             | **介绍** |
  | :- | :- |
  | [MiniMax Hailuo 2.3](/docs/api-reference/video-generation-t2v) | 全新视频生成模型，肢体动作、面部表情、物理表现与指令遵循再度突破 |
  | [MiniMax Hailuo 2.3 Fast](/docs/api-reference/video-generation-i2v) | 全新图生视频模型，物理表现与指令遵循具佳，更快更优惠 |
  | [MiniMax Hailuo 02](/docs/api-reference/video-generation-t2v) | 新一代视频生成模型，1080p 原生，SOTA 指令遵循，极致物理表现 |
</Accordion>

### 语音模型

| **模型名称**             | **介绍**                                                         |
| :- | :- |
| [Speech-2.8-HD](/docs/api-reference/speech-t2a-http) | 新一代语音 HD 模型，情绪渲染融合语气词，重塑自然听感 |
| [Speech-2.8-Turbo](/docs/api-reference/speech-t2a-http) | 新一代语音 Turbo 模型，极致生成速度，更自然逼真的音频效果 |

<Accordion title="历史模型">
  | **模型名称**             | **介绍**                                                         |
  | :- | :- |
  | [Speech-2.6-HD](/docs/api-reference/speech-t2a-http) | 极致音质与韵律表现，生成更快更自然 |
  | [Speech-2.6-Turbo](/docs/api-reference/speech-t2a-http) | 音质优异，超低时延，响应更灵敏 |
  | [Speech-02-HD](/docs/api-reference/speech-t2a-http) | 语音 HD 模型，拥有出色的韵律和稳定性，复刻相似度和音质表现突出 |
  | [Speech-02-Turbo](/docs/api-reference/speech-t2a-http) | 语音 Turbo 模型，小语种能力增强，性能表现出色 |
</Accordion>

### 图片模型

| **模型名称**            | **介绍**                                                         |
| :- | :- |
| [image-01](/docs/api-reference/image-generation-t2i) | 图像生成模型，画面表现细腻，支持文生图、图生图 |
| [image-01-live](/docs/api-reference/image-generation-t2i) | 图像生成模型，手绘、卡通等画风增强，支持文生图并进行画风设置 |

### 音乐模型

<Note title="Music API 服务调整通知">
  自 2026 年 8 月 20 日起，付费接口（音乐生成、歌词生成）不再面向新用户提供服务，历史付费用户可继续使用现有 API 服务；免费音乐生成接口（Music-3.0-free、Music-2.6-free、music-cover-free）停止服务。

  如需体验或使用音乐生成能力，可前往 [MiniMax Audio](https://www.minimax.cn/audio)，或使用已发布在 [Hugging Face](https://huggingface.co/MiniMaxAI/MiniMax-Music3) 和 [魔搭 ModelScope](https://modelscope.cn/models/MiniMax/MiniMax-Music3) 的 MiniMax Music 3 开源模型。
</Note>

| **模型名称**            | **介绍**                                                          |
| :- | :- |
| [music-3.0](/docs/api-reference/music-generation) | 更懂创作意图，音质全面跃升，人声合成更自然 |
| [music-2.6](/docs/api-reference/music-generation) | 以声传情：翻唱入心，器乐入魂 |
| [music-cover](/docs/api-reference/music-generation) | 基于参考音频生成翻唱版本，支持一步翻唱和两步翻唱（可修改歌词），支持风格迁移和自动歌词提取 |


> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimaxi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 前置准备

> 在开始使用 MiniMax API 之前，需要完成账户注册和 API Key 获取。

<Steps>
  <Step title="账户注册/登录">
    API 调用前，需在 MiniMax 开放平台进行[账户注册](https://platform.minimax.cn/login?source=platform_docs)，企业团队注册请参考页面底部说明.
  </Step>

  <Step title="获取 Key">
    * **按量付费**：通过 [接口密钥 > 创建新的 API Key](https://platform.minimax.cn/user-center/basic-information/interface-key)，获取 **API Key**
      <Note>按量付费支持使用所有模态模型，包括语言、视频、语音、图像等</Note>
    * **M Plan**：通过 [订阅管理 > M Plan](https://platform.minimax.cn/user-center/payment/token-plan)，查看 **订阅 Key**
      <Note>订阅 Key 用于 M Plan 订阅套餐和已购积分。它可以在付费资源可用之前就存在；当您拥有 M Plan 席位或积分权限后才可实际使用资源。详情见 [M Plan 概要](https://platform.minimax.cn/docs/m-plan/intro)</Note>

    生成 API Key 后，建议将其存储为环境变量或保存到 `.env` 文件中：

    * 推荐使用 Anthropic API 兼容，具体查看：[Anthropic SDK](/docs/api-reference/text-anthropic-api)

      ```bash theme={null}
      export ANTHROPIC_BASE_URL=https://api.minimax.cn/anthropic
      export ANTHROPIC_API_KEY=${YOUR_API_KEY}
      ```

    * 使用 OpenAI API 兼容，具体查看：[OpenAI SDK](/docs/api-reference/text-openai-api)

      ```bash theme={null}
      export OPENAI_BASE_URL=https://api.minimax.cn/v1
      export OPENAI_API_KEY=${YOUR_API_KEY}
      ```

    * 使用 AI SDK 兼容，具体查看：[AI SDK](/docs/api-reference/text-ai-sdk)

      ```bash theme={null}
      export MINIMAX_API_KEY=${YOUR_API_KEY}
      ```
  </Step>

  <Step title="添加资源">
    按量付费可通过 [账户管理 > 余额](https://platform.minimax.cn/user-center/payment/balance) 按需充值。M Plan 可购买订阅或积分，也可以使用团队分配给您的资源。
  </Step>
</Steps>

***

<Accordion title="企业团队注册说明">
  建议采用**主账号+子账号**的形式创建和管理。

  1. 在 [MiniMax 开放平台](https://platform.minimax.cn/user-center/basic-information) 注册一个账号（此账号即为主账号，注册时填写的姓名与手机号会成为本企业账号的管理员信息）
  2. 登录该主账号，在 [账户管理 > 子账号](https://platform.minimax.cn/user-center/basic-information/child-account)，创建您所需要数量的子账户（子账号的创建数量暂时没有限制）
  3. 为您企业的人员，分配不同的子账户，进行登录使用

  **子账户权限说明：**

  * 子账号和主账号享用相同的使用权益与速率限制，子账号和主账号的 API 消耗共享，统一结算
  * 子账号无查看和管理"支付"权限
</Accordion>



> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimaxi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 通过 SDK 接入

> 使用 Anthropic SDK 快速接入 MiniMax API，开始调用 MiniMax-M3 模型。

<Steps>
  <Step title="安装 Anthropic SDK（推荐）">
    <CodeGroup>
      ```bash Python theme={null}
      pip install anthropic
      ```

      ```bash Node.js theme={null}
      npm install @anthropic-ai/sdk
      ```
    </CodeGroup>
  </Step>

  <Step title="调用 MiniMax-M3">
    ```python Python theme={null}
    import anthropic

    client = anthropic.Anthropic()

    message = client.messages.create(
        model="MiniMax-M3",
        max_tokens=1000,
        system="You are a helpful assistant.",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Hi, how are you?"
                    }
                ]
            }
        ]
    )

    for block in message.content:
        if block.type == "thinking":
            print(f"Thinking:\n{block.thinking}\n")
        elif block.type == "text":
            print(f"Text:\n{block.text}\n")
    ```
  </Step>

  <Step title="示例输出">
    ```json theme={null}
    {
      "thinking": "The user is just greeting me casually. I should respond in a friendly, professional manner.",
      "text": "Hi there! I'm doing well, thanks for asking. I'm ready to help you with whatever you need today—whether it's coding, answering questions, brainstorming ideas, or just chatting. What can I do for you?"
    }
    ```
  </Step>
</Steps>

## 探索更多

<Columns cols={3}>
  <Card title="语言模型" icon="book-open" href="/docs/guides/text-generation" cta="点击查看">
    探索 MiniMax 最新语言模型
  </Card>

  <Card title="视频生成" icon="video" href="/docs/guides/video-generation" cta="点击查看">
    使用 MiniMax-H3 创建视频生成任务
  </Card>

  <Card title="同步语音合成" icon="mic" href="/docs/guides/speech-t2a-websocket" cta="点击查看">
    使用 Speech 2.8 进行同步语音合成
  </Card>

  <Card title="异步语音合成" icon="mic" href="/docs/guides/speech-t2a-async" cta="点击查看">
    使用 Speech 2.8 进行异步语音合成
  </Card>

  <Card title="音色复刻" icon="mic" href="/docs/guides/speech-voice-clone" cta="点击查看">
    创建音色复刻任务
  </Card>

  <Card title="音乐生成" icon="music" href="/docs/guides/music-generation" cta="点击查看">
    使用 Music 3.0 进行音乐创作
  </Card>
</Columns>



