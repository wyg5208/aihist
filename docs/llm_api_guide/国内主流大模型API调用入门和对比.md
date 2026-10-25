# 国内主流大模型API调用入门与对比指南

随着人工智能技术的飞速发展，国内大模型厂商推出的API服务已经相当成熟本文将详细介绍**DeepSeek**、**智谱GLM**、**Kimi（月之暗面）**和**阿里千问**四大主流国产大模型的API调用方式，帮助开发者快速上手并选择最适合自己业务需求的方案。

## 一、API调用通用模式

虽然各厂商的API细节有所不同，但核心调用模式基本一致，都遵循以下结构：

```
┌─────────────────────────────────────────────────────┐
│                    API 调用流程                       │
├─────────────────────────────────────────────────────┤
│  1. 获取 API Key (身份认证)                          │
│  2. 选择 API 端点 (base_url)                        │
│  3. 构造 messages 请求体                             │
│     - system: 系统提示词                             │
│     - user: 用户输入                                │
│     - assistant: 模型回复                           │
│  4. 调用 chat.completions.create()                  │
│  5. 解析响应获取结果                                │
└─────────────────────────────────────────────────────┘
```

### 核心参数说明

| 参数 | 说明 | 常用取值 |
|------|------|---------|
| model | 模型标识 | 各厂商不同 |
| messages | 对话消息列表 | system/user/assistant |
| temperature | 控制随机性 | 0.0-2.0，越低越确定 |
| max_tokens | 最大输出token数 | 根据需求设置 |
| stream | 是否流式输出 | true/false |

---

## 二、DeepSeek

DeepSeek以其高性价比和强大的推理能力著称，特别适合需要复杂推理能力的应用场景。

### 2.1 快速开始

**API端点**: `https://api.deepseek.com`

**安装依赖**:
```bash
pip install openai
```

**Python调用示例**:
```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "system", "content": "You are a helpful assistant"},
        {"role": "user", "content": "Hello"},
    ],
    max_tokens=1024,
    temperature=0.7,
    stream=False
)

print(response.choices[0].message.content)
```

**cURL调用**:
```bash
curl -X POST https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

### 2.2 主要特色

| 特色 | 说明 |
|------|------|
| **思考模型** | deepseek-reasoner 支持深度思考模式 |
| **OpenAI兼容** | 完美兼容OpenAI SDK |
| **超低价格** | 性价比极高 |
| **长上下文** | 支持128K上下文窗口 |

### 2.3 Token计算

```
1 个中文字符 ≈ 0.6 个 token
1 个英文字符 ≈ 0.3 个 token
```

---

## 三、智谱GLM

智谱AI是国内最早的大模型厂商之一，GLM系列模型在中文理解方面表现优异，且提供了丰富的SDK支持。

### 3.1 快速开始

**API端点**: `https://open.bigmodel.cn/api/paas/v4`

**安装SDK**:
```bash
# 新版SDK (推荐)
pip install zai-sdk

# 旧版SDK
pip install zhipuai
```

**使用新版SDK调用**:
```python
from zai import ZhipuAiClient

client = ZhipuAiClient(api_key="YOUR_API_KEY")

response = client.chat.completions.create(
    model="glm-5",
    messages=[
        {"role": "system", "content": "你是一个有用的AI助手"},
        {"role": "user", "content": "你好，请介绍一下自己"}
    ],
    temperature=0.6
)

print(response.choices[0].message.content)
```

**使用OpenAI兼容方式**:
```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://open.bigmodel.cn/api/paas/v4"
)

response = client.chat.completions.create(
    model="glm-5",
    messages=[
        {"role": "system", "content": "你是AI助手"},
        {"role": "user", "content": "你好"}
    ]
)
```

### 3.2 主要模型

| 模型 | 定位 | 上下文 | 特点 |
|------|------|--------|------|
| **GLM-5** | 旗舰 | 32K+ | 最新一代，逼近Claude Opus级别 |
| **GLM-4-Plus** | 高智能 | 128K | 智能旗舰 |
| **GLM-4-Air-250414** | 高性价比 | 128K | 价格实惠 |
| **GLM-Z1-FlashX** | 高速低价 | 128K | 极速响应 |
| **GLM-4.6V** | 多模态 | 128K | 视觉理解SOTA |
| **GLM-4.7-Flash** | 免费 | 200K | 完全免费 |

### 3.3 价格参考

| 模型 | 输入价格 | 输出价格 |
|------|---------|---------|
| GLM-5 | 4-6元/百万tokens | 18-22元/百万tokens |
| GLM-4-Plus | 5元/百万tokens | 2.5元/百万tokens |
| GLM-4-Air | 0.5元/百万tokens | 0.25元/百万tokens |
| GLM-Z1-FlashX | 0.1元/百万tokens | 免费 |

---

## 四、Kimi (Moonshot AI)

月之暗面推出的Kimi以超长上下文窗口著称，其K2系列模型在代码能力和推理方面表现突出。

### 4.1 快速开始

**API端点**: `https://api.moonshot.cn`

**安装依赖**:
```bash
pip install openai>=1.0
```

**Python调用示例**:
```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://api.moonshot.cn/v1"
)

# 单轮对话
response = client.chat.completions.create(
    model="kimi-k2-turbo-preview",
    messages=[
        {"role": "system", "content": "你是Kimi，由Moonshot AI提供的人工智能助手"},
        {"role": "user", "content": "你好，我叫李雷"}
    ],
    temperature=0.6
)

print(response.choices[0].message.content)
```

**多轮对话实现**:
```python
history = [
    {"role": "system", "content": "你是Kimi助手"}
]

def chat(query, history):
    history.append({"role": "user", "content": query})
    
    response = client.chat.completions.create(
        model="kimi-k2-turbo-preview",
        messages=history,
        temperature=0.6
    )
    
    result = response.choices[0].message.content
    history.append({"role": "assistant", "content": result})
    return result

# 多轮调用示例
print(chat("地球的自转周期是多少？", history))
print(chat("月球呢？", history))
```

### 4.2 主要模型

| 模型 | 上下文 | 特点 |
|------|--------|------|
| **kimi-k2.5** | 128K | 最新旗舰，深度思考 |
| **kimi-k2-turbo-preview** | 128K | 高性能Turbo版 |
| **moonshot-v1-128k** | 128K | 长文本处理 |
| **moonshot-v1-32k** | 32K | 平衡之选 |
| **moonshot-v1-8k** | 8K | 基础版本 |
| **moonshot-v1-8k-vision-preview** | 8K | 支持图片理解 |

### 4.3 Token计算接口

Kimi提供了专门的Token计算API，帮助精确估算用量：

```python
import requests

response = requests.post(
    "https://api.moonshot.cn/v1/tokenizers/estimate-token-count",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    },
    json={
        "model": "kimi-k2-turbo-preview",
        "messages": [
            {"role": "system", "content": "你是Kimi"},
            {"role": "user", "content": "你好"}
        ]
    }
)

print(f"Token数量: {response.json()['data']['total_tokens']}")
```

---

## 五、阿里千问 (Qwen)

阿里云百炼平台提供的千问系列模型覆盖从轻量到旗舰的完整产品线，且支持多地域部署。

### 5.1 快速开始

**API端点**: 
- 北京: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 新加坡: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`

**安装SDK**:
```bash
pip install openai dashscope
```

**使用OpenAI兼容方式**:
```python
from openai import OpenAI
import os

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

response = client.chat.completions.create(
    model="qwen3.5-plus",
    messages=[
        {"role": "system", "content": "You are a helpful assistant"},
        {"role": "user", "content": "你是谁？"}
    ]
)

print(response.choices[0].message.content)
```

**使用DashScope SDK**:
```python
from dashscope import Generation

response = Generation.call(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model="qwen-plus",
    messages=[
        {"role": "system", "content": "You are a helpful assistant"},
        {"role": "user", "content": "你好"}
    ],
    result_format="message"
)

print(response.output.choices[0].message.content)
```

**cURL调用**:
```bash
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5-plus",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant"},
      {"role": "user", "content": "你好"}
    ]
  }'
```

### 5.2 主要模型

| 模型 | 定位 | 特点 |
|------|------|------|
| **Qwen3.5-Plus** | 均衡之选 | 推荐大多数场景使用 |
| **Qwen3.5-Max** | 效果最佳 | 复杂任务首选 |
| **Qwen3.5-Flash** | 极速低价 | 简单任务/高并发 |
| **Qwen-VL-Plus** | 多模态 | 视觉理解 |
| **Qwen3 开源系列** | 开源免费 | 本地部署 |

### 5.3 多模态调用示例

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://example.com/image.png"
                }
            },
            {
                "type": "text",
                "text": "请描述这张图片"
            }
        ]
    }
]

response = client.chat.completions.create(
    model="qwen3.5-plus",
    messages=messages
)
```

---

## 六、流式输出实现

所有主流大模型API都支持流式输出(SSE)，可以显著提升用户体验：

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://api.moonshot.cn/v1"
)

stream = client.chat.completions.create(
    model="kimi-k2-turbo-preview",
    messages=[
        {"role": "user", "content": "写一个关于AI的故事"}
    ],
    stream=True
)

# 实时打印输出
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

## 七、综合对比

| 对比维度 | DeepSeek | 智谱GLM | Kimi | 千问 |
|---------|-----------|---------|------|------|
| **API端点** | api.deepseek.com | open.bigmodel.cn | api.moonshot.cn | dashscope.aliyuncs.com |
| **SDK兼容性** | OpenAI | OpenAI + 专属SDK | OpenAI | OpenAI + DashScope |
| **最大上下文** | 128K | 200K | 128K | 128K |
| **多模态** | 图片/视频 | 图片/视频/文档 | 图片/视频 | 图片/视频 |
| **思考模型** | ✅ deepseek-reasoner | ✅ GLM-5 | ✅ kimi-k2.5 | ✅ Qwen3.5系列 |
| **免费额度** | 有 | 有(Free模型) | 有 | 有 |
| **特色优势** | 性价比高/推理强 | 中文理解好 | 超长上下文 | 生态完善/多地域 |

### 选型建议

```
┌────────────────────────────────────────────────────────────┐
│                     场景选型指南                            │
├────────────────────────────────────────────────────────────┤
│  💰 预算敏感 / 复杂推理任务     →  DeepSeek                 │
│  📝 中文内容创作/长文档分析    →  智谱GLM                   │
│  📚 超长文本处理/代码任务      →  Kimi                      │
│  🏢 企业级应用/多地域部署      →  阿里千问                  │
│  🔧 需要快速迁移OpenAI代码    →  DeepSeek / Kimi / 千问    │
└────────────────────────────────────────────────────────────┘
```

---

## 八、常见问题

### Q1: 如何选择temperature参数？

| 场景 | 推荐值 | 说明 |
|------|--------|------|
| 代码生成 | 0.2-0.3 | 需要确定性输出 |
| 事实问答 | 0.1-0.2 | 准确为主 |
| 创意写作 | 0.7-0.9 | 需要多样性 |
| 通用对话 | 0.6-0.7 | 平衡选项 |

### Q2: 如何估算API成本？

以1000字中文文章为例：
- 约600-700 tokens
- 各平台价格约0.01-0.1元/百万tokens输出

### Q3: 遇到401认证错误怎么办？

1. 检查API Key是否正确
2. 确认API Key是否已激活
3. 检查环境变量配置
4. 确认账户余额充足

### Q4: 如何处理流式输出的中断？

```python
import time

for chunk in stream:
    try:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")
    except Exception as e:
        print(f"\n连接中断: {e}")
        time.sleep(1)  # 重试等待
        # 可添加重试逻辑
```

---

## 九、总结

本文详细介绍了国内四大主流大模型API的调用方式：

1. **DeepSeek** - 性价比之王，适合预算敏感型项目和复杂推理任务
2. **智谱GLM** - 中文理解优秀，SDK完善，适合中文内容创作场景
3. **Kimi** - 超长上下文能力突出，适合长文档处理和代码任务
4. **阿里千问** - 生态完善，多地域支持，适合企业级应用

所有厂商都提供了OpenAI兼容的接口，便于开发者快速迁移和对比。建议根据具体业务场景和预算选择合适的模型，并善用各平台的免费额度进行测试。

> **提示**: 各平台API和价格可能持续更新，建议开发者在正式使用前查阅各平台最新官方文档。
