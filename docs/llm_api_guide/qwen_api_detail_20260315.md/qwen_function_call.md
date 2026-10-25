
大模型在面对实时性问题、数学计算等问题时可能效果不佳。Function Calling 通过引入外部工具，让大模型可以回答原本无法解决的问题。

## **工作原理**

Function Calling 通过在应用程序和大模型之间的多步骤交互，使大模型可以参考外部工具信息进行回答。

1.  **发起第一次模型调用**
    
    应用程序首先向大模型发起一个包含用户问题与模型可调用工具清单的请求。
    
2.  **接收模型的工具调用指令（工具名称与入参）**
    
    若模型判断需要调用外部工具，会返回一个JSON格式的指令，用于告知应用程序需要执行的函数与入参。
    
    > 若模型判断无需调用工具，会返回自然语言格式的回复。
    
3.  **在应用端运行工具**
    
    应用程序接收到工具指令后，需要运行工具，获得工具输出结果。
    
4.  **发起第二次模型调用**
    
    获取到工具输出结果后，需添加至模型的上下文（messages），再次发起模型调用。
    
5.  **接收来自模型的最终响应**
    
    模型将工具输出结果和用户问题信息整合，生成自然语言格式的回复。
    

工作流程示意图如下所示：

![image](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/0504113771/CAEQYhiBgIDE9unxyRkiIDVjNDgwMDBjYTE0NzQ5MTBiMzBiNjJkNTk5ZjE2YTIz4358988_20240409160230.951.svg)

## **支持的模型**

## 千问

-   **文本生成模型**
    
    -   [千问Max](https://help.aliyun.com/zh/model-studio/models#d4ccf72f23jh9)
        
    -   [千问Plus](https://help.aliyun.com/zh/model-studio/models#bb0ffee88bwnk)
        
    -   [千问Flash](https://help.aliyun.com/zh/model-studio/models#d617df95f1g9h)
        
    -   [千问Coder](https://help.aliyun.com/zh/model-studio/models#d698550551bob)
        
    -   [千问Turbo](https://help.aliyun.com/zh/model-studio/models#ff492e2c10lub)
        
    -   [Qwen3.5](https://help.aliyun.com/zh/model-studio/models#479d0567e1a8z)
        
    -   [Qwen3](https://help.aliyun.com/zh/model-studio/models#9d516d17965af)
        
    -   [Qwen2.5](https://help.aliyun.com/zh/model-studio/models#e4831f1e9388j)
        
    -   [Qwen2](https://help.aliyun.com/zh/model-studio/models#5d2908c05460t)
        
    -   [Qwen1.5](https://help.aliyun.com/zh/model-studio/models#6440fb9f9813i)
        
-   **多模态模型**
    
    -   [千问VL](https://help.aliyun.com/zh/model-studio/models#18da4b21522xf)（仅包括 qwen3-vl-plus、 qwen3-vl-flash系列）
        
    -   [千问Omni](https://help.aliyun.com/zh/model-studio/models#683598c02e67r)（仅包括 qwen3-omni-flash 系列）
        
    -   [Qwen3-VL](https://help.aliyun.com/zh/model-studio/models#a7a9da8f6em1a)
        

## DeepSeek

-   deepseek-v3.2
    
-   deepseek-v3.2-exp（非思考模式）
    
-   deepseek-v3.1（非思考模式）
    
-   deepseek-r1
    
-   deepseek-r1-0528
    
-   deepseek-v3
    

## GLM

-   glm-4.7
    
-   glm-4.6
    
-   glm-4.5
    
-   glm-4.5-air
    

## Kimi

-   kimi-k2.5
    
-   kimi-k2-thinking
    
-   Moonshot-Kimi-K2-Instruct
    

## MiniMax

MiniMax-M2.1

## **快速开始**

您需要已[获取API Key](https://help.aliyun.com/zh/model-studio/get-api-key)并[配置API Key到环境变量](https://help.aliyun.com/zh/model-studio/configure-api-key-through-environment-variables)。如果通过 OpenAI SDK 或 DashScope SDK 进行调用，需要[安装SDK](https://help.aliyun.com/zh/model-studio/install-sdk#210ee28162bs7)。

以天气查询场景为例，介绍快速使用 Function Calling 的方法。

## OpenAI 兼容

Python

```
from openai import OpenAI
from datetime import datetime
import json
import os
import random


# 初始化客户端
client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)
# 模拟用户问题
USER_QUESTION = "北京天气咋样"
# 定义工具列表
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。",
                    }
                },
                "required": ["location"],
            },
        },
    },
]


# 模拟天气查询工具
def get_current_weather(arguments):
    weather_conditions = ["晴天", "多云", "雨天"]
    random_weather = random.choice(weather_conditions)
    location = arguments["location"]
    return f"{location}今天是{random_weather}。"


# 封装模型响应函数
def get_response(messages):
    completion = client.chat.completions.create(
        model="qwen-plus",
        messages=messages,
        tools=tools,
    )
    return completion


messages = [{"role": "user", "content": USER_QUESTION}]
response = get_response(messages)
assistant_output = response.choices[0].message
if assistant_output.content is None:
    assistant_output.content = ""
messages.append(assistant_output)
# 如果不需要调用工具，直接输出内容
if assistant_output.tool_calls is None:
    print(f"无需调用天气查询工具，直接回复：{assistant_output.content}")
else:
    # 进入工具调用循环
    while assistant_output.tool_calls is not None:
        tool_call = assistant_output.tool_calls[0]
        tool_call_id = tool_call.id
        func_name = tool_call.function.name
        arguments = json.loads(tool_call.function.arguments)
        print(f"正在调用工具 [{func_name}]，参数：{arguments}")
        # 执行工具
        tool_result = get_current_weather(arguments)
        # 构造工具返回信息
        tool_message = {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": tool_result,  # 保持原始工具输出
        }
        print(f"工具返回：{tool_message['content']}")
        messages.append(tool_message)
        # 再次调用模型，获取总结后的自然语言回复
        response = get_response(messages)
        assistant_output = response.choices[0].message
        if assistant_output.content is None:
            assistant_output.content = ""
        messages.append(assistant_output)
    print(f"助手最终回复：{assistant_output.content}")
```

Node.js

```
import OpenAI from 'openai';  
  
// 初始化客户端  
const openai = new OpenAI({  
  // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
  // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
  apiKey: process.env.DASHSCOPE_API_KEY,  
  // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",  
});  
  
// 定义工具列表  
const tools = [  
  {  
    type: "function",  
    function: {  
      name: "get_current_weather",  
      description: "当你想查询指定城市的天气时非常有用。",  
      parameters: {  
        type: "object",  
        properties: {  
          location: {  
            type: "string",  
            description: "城市或县区，比如北京市、杭州市、余杭区等。",  
          },  
        },  
        required: ["location"],  
      },  
    },  
  },  
];  
  
// 模拟天气查询工具  
const getCurrentWeather = (args) => {  
  const weatherConditions = ["晴天", "多云", "雨天"];  
  const randomWeather = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];  
  const location = args.location;  
  return `${location}今天是${randomWeather}。`;  
};  
  
// 封装模型响应函数  
const getResponse = async (messages) => {  
  const response = await openai.chat.completions.create({  
    model: "qwen-plus",  
    messages: messages,  
    tools: tools,  
  });  
  return response;  
};  

const main = async () => {  
  const input = "北京天气咋样";

  let messages = [  
    {  
      role: "user",  
      content: input,  
    }  
  ];  
  let response = await getResponse(messages);  
  let assistantOutput = response.choices[0].message;  
  // 确保 content 不是 null  
  if (!assistantOutput.content) assistantOutput.content = "";  
  messages.push(assistantOutput);  
  // 判断是否需要调用工具  
  if (!assistantOutput.tool_calls) {  
    console.log(`无需调用天气查询工具，直接回复：${assistantOutput.content}`);  
  } else {  
    // 进入工具调用循环  
    while (assistantOutput.tool_calls) {  
      const toolCall = assistantOutput.tool_calls[0];  
      const toolCallId = toolCall.id;  
      const funcName = toolCall.function.name;  
      const funcArgs = JSON.parse(toolCall.function.arguments);  
      console.log(`正在调用工具 [${funcName}]，参数：`, funcArgs);  
      // 执行工具  
      const toolResult = getCurrentWeather(funcArgs);  
      // 构造工具返回信息  
      const toolMessage = {  
        role: "tool",  
        tool_call_id: toolCallId,  
        content: toolResult,  
      };  
      console.log(`工具返回：${toolMessage.content}`);  
      messages.push(toolMessage);  
      // 再次调用模型获取自然语言总结  
      response = await getResponse(messages);  
      assistantOutput = response.choices[0].message;  
      if (!assistantOutput.content) assistantOutput.content = "";  
      messages.push(assistantOutput);  
    }  
    console.log(`助手最终回复：${assistantOutput.content}`);  
  }  
};  
  
// 启动程序  
main().catch(console.error);
```

## DashScope

Python

```
import os
from dashscope import Generation
import json
import random
import dashscope 

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

# 1. 定义工具列表
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。",
                    }
                },
                "required": ["location"],
            },
        },
    }
]

# 2. 模拟天气查询工具
def get_current_weather(arguments):
    weather_conditions = ["晴天", "多云", "雨天"]
    random_weather = random.choice(weather_conditions)
    location = arguments["location"]
    return f"{location}今天是{random_weather}。"

# 3. 封装模型响应函数
def get_response(messages):
    response = Generation.call(
        # 如果没有配置环境变量，请将下行替换为api_key="sk-xxx"
        api_key=os.getenv("DASHSCOPE_API_KEY"),
        model="qwen-plus",
        messages=messages,
        tools=tools,
        result_format="message",
    )
    return response

# 4. 初始化对话历史
messages = [
    {
        "role": "user",
        "content": "北京天气咋样"
    }
]

# 5. 第一次调用模型
response = get_response(messages)
assistant_output = response.output.choices[0].message
messages.append(assistant_output)

# 6. 判断是否需要调用工具
if "tool_calls" not in assistant_output or not assistant_output["tool_calls"]:
    print(f"无需调用工具，直接回复：{assistant_output['content']}")
else:
    # 7. 进入工具调用循环
    # 循环条件：只要最新的模型回复中包含工具调用请求
    while "tool_calls" in assistant_output and assistant_output["tool_calls"]:
        tool_call = assistant_output["tool_calls"][0]
        # 解析工具调用的信息
        func_name = tool_call["function"]["name"]
        arguments = json.loads(tool_call["function"]["arguments"])
        tool_call_id = tool_call.get("id")  # 获取 tool_call_id
        print(f"正在调用工具 [{func_name}]，参数：{arguments}")
        # 执行对应的工具函数
        tool_result = get_current_weather(arguments)
        # 构造工具返回信息
        tool_message = {
            "role": "tool",
            "content": tool_result,
            "tool_call_id": tool_call_id
        }
        print(f"工具返回：{tool_message['content']}")
        messages.append(tool_message)
        # 再次调用模型，让模型基于工具结果进行回复
        response = get_response(messages)
        assistant_output = response.output.choices[0].message
        messages.append(assistant_output)
    # 8. 输出最终的自然语言回复
    print(f"助手最终回复：{assistant_output['content']}")
```

Java

```
import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import com.alibaba.dashscope.exception.InputRequiredException;
import com.alibaba.dashscope.exception.NoApiKeyException;
import com.alibaba.dashscope.tools.FunctionDefinition;
import com.alibaba.dashscope.tools.ToolCallBase;
import com.alibaba.dashscope.tools.ToolCallFunction;
import com.alibaba.dashscope.tools.ToolFunction;
import com.alibaba.dashscope.utils.Constants;
import com.alibaba.dashscope.utils.JsonUtils;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

public class Main {
    // 若使用新加坡地域的模型，请释放下列注释
    // static {Constants.baseHttpApiUrl="https://dashscope-intl.aliyuncs.com/api/v1";}
    
    /**
     * 第一步：定义工具的本地实现。
     * @param arguments 模型传入的、包含工具所需参数的JSON字符串。
     * @return 工具执行后的结果字符串。
     */
    public static String getCurrentWeather(String arguments) {
        try {
            // 模型提供的参数是JSON格式的，需要我们手动解析。
            ObjectMapper objectMapper = new ObjectMapper();
            JsonNode argsNode = objectMapper.readTree(arguments);
            String location = argsNode.get("location").asText();

            // 用随机结果来模拟真实的API调用或业务逻辑。
            List<String> weatherConditions = Arrays.asList("晴天", "多云", "雨天");
            String randomWeather = weatherConditions.get(new Random().nextInt(weatherConditions.size()));

            return location + "今天是" + randomWeather + "。";
        } catch (Exception e) {
            // 异常处理，确保程序健壮性。
            return "无法解析地点参数。";
        }
    }

    public static void main(String[] args) {
        try {
            // 第二步：向模型描述（注册）我们的工具。
            String weatherParamsSchema =
                    "{\"type\":\"object\",\"properties\":{\"location\":{\"type\":\"string\",\"description\":\"城市或县区，比如北京市、杭州市、余杭区等。\"}},\"required\":[\"location\"]}";

            FunctionDefinition weatherFunction = FunctionDefinition.builder()
                    .name("get_current_weather") // 工具的唯一标识名，必须与本地实现对应。
                    .description("当你想查询指定城市的天气时非常有用。") // 清晰的描述能帮助模型更好地决定何时使用该工具。
                    .parameters(JsonUtils.parseString(weatherParamsSchema).getAsJsonObject())
                    .build();
            Generation gen = new Generation();
            String userInput = "北京天气咋样";

            List<Message> messages = new ArrayList<>();
            messages.add(Message.builder().role(Role.USER.getValue()).content(userInput).build());

            // 第四步：首次调用模型。将用户的请求和我们定义好的工具列表一同发送给模型。
            GenerationParam param = GenerationParam.builder()
                    .model("qwen-plus") // 指定需要调用的模型。
                    .apiKey(System.getenv("DASHSCOPE_API_KEY")) // 从环境变量中获取API Key。
                    .messages(messages) // 传入当前的对话历史。
                    .tools(Arrays.asList(ToolFunction.builder().function(weatherFunction).build())) // 传入可用的工具列表。
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = gen.call(param);
            Message assistantOutput = result.getOutput().getChoices().get(0).getMessage();
            messages.add(assistantOutput); // 将模型的首次回复也加入到对话历史中。

            // 第五步：检查模型的回复，判断它是否请求调用工具。
            if (assistantOutput.getToolCalls() == null || assistantOutput.getToolCalls().isEmpty()) {
                // 情况A：模型没有调用工具，而是直接给出了回答。
                System.out.println("无需调用天气查询工具，直接回复：" + assistantOutput.getContent());
            } else {
                // 情况B：模型决定调用工具。
                // 使用 while 循环可以处理模型连续调用多次工具的场景。
                while (assistantOutput.getToolCalls() != null && !assistantOutput.getToolCalls().isEmpty()) {
                    ToolCallBase toolCall = assistantOutput.getToolCalls().get(0);

                    // 从模型的回复中解析出工具调用的具体信息（要调用的函数名、参数）。
                    ToolCallFunction functionCall = (ToolCallFunction) toolCall;
                    String funcName = functionCall.getFunction().getName();
                    String arguments = functionCall.getFunction().getArguments();
                    System.out.println("正在调用工具 [" + funcName + "]，参数：" + arguments);

                    // 根据工具名，在本地执行对应的Java方法。
                    String toolResult = getCurrentWeather(arguments);

                    // 构造一个 role 为 "tool" 的消息，其中包含工具的执行结果。
                    Message toolMessage = Message.builder()
                            .role("tool")
                            .toolCallId(toolCall.getId())
                            .content(toolResult)
                            .build();
                    System.out.println("工具返回：" + toolMessage.getContent());
                    messages.add(toolMessage); // 将工具的返回结果也加入到对话历史中。

                    // 第六步：再次调用模型。
                    param.setMessages(messages);
                    result = gen.call(param);
                    assistantOutput = result.getOutput().getChoices().get(0).getMessage();
                    messages.add(assistantOutput);
                }

                // 第七步：打印模型经过总结后，生成的最终回复。
                System.out.println("助手最终回复：" + assistantOutput.getContent());
            }

        } catch (NoApiKeyException | InputRequiredException e) {
            System.err.println("错误: " + e.getMessage());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

运行后得到如下输出：

```
正在调用工具 [get_current_weather]，参数：{'location': '北京'}
工具返回：北京今天是多云。
助手最终回复：北京今天是多云的天气。
```

## **如何使用**

Function Calling 支持两种传入工具信息的方式：

-   方式一：通过 tools 参数传入（推荐）
    
    请参见[如何使用](#038e24005c1vt)，按照**定义工具**、**创建messages数组**、**发起 Function Calling**、**运行工具函数**、**大模型总结工具函数输出**的步骤进行调用。
    
-   方式二：通过 System Message 传入
    
    通过 tools 参数传入时，服务端会根据模型自动适配合适的 prompt 模板并组装，因此推荐您优先使用 tools 参数。 如果您在使用 Qwen 模型时不期望使用 tools 参数，请参见[通过 System Message 传入工具信息](#afa52dfc56tqq)。
    

以下内容以 OpenAI 兼容调用方式为例，通过 tools 参数传入工具信息，向您分步骤介绍 Function Calling 的详细用法。

假设业务场景中会收到天气查询与时间查询两类问题。

### **1\. 定义工具**

工具是连接大模型与外部世界的桥梁，首先需要定义工具。

#### **1.1. 创建工具函数**

创建两个工具函数：天气查询工具与时间查询工具。

-   **天气查询工具**
    
    接收`arguments`参数，`arguments`格式为`{"location": "查询的地点"}`。工具的输出为字符串，格式为：`“{位置}今天是{天气}”`。
    
    > 为了便于演示，此处定义的天气查询工具并不真正查询天气，会从晴天、多云、雨天随机选择。在实际业务中可使用如[高德天气查询](https://lbs.amap.com/api/webservice/guide/api/weatherinfo)等工具进行替换。
    
-   **时间查询工具**
    
    时间查询工具不需要输入参数。工具的输出为字符串，格式为：`“当前时间：{查询到的时间}。”`。
    
    > 如果使用 Node.js，请运行`npm install date-fns`安装获取时间的工具包 date-fns：
    

Python

```
## 步骤1:定义工具函数

# 添加导入random模块
import random
from datetime import datetime

# 模拟天气查询工具。返回结果示例：“北京今天是雨天。”
def get_current_weather(arguments):
    # 定义备选的天气条件列表
    weather_conditions = ["晴天", "多云", "雨天"]
    # 随机选择一个天气条件
    random_weather = random.choice(weather_conditions)
    # 从 JSON 中提取位置信息
    location = arguments["location"]
    # 返回格式化的天气信息
    return f"{location}今天是{random_weather}。"

# 查询当前时间的工具。返回结果示例：“当前时间：2024-04-15 17:15:18。“
def get_current_time():
    # 获取当前日期和时间
    current_datetime = datetime.now()
    # 格式化当前日期和时间
    formatted_time = current_datetime.strftime('%Y-%m-%d %H:%M:%S')
    # 返回格式化后的当前时间
    return f"当前时间：{formatted_time}。"

# 测试工具函数并输出结果，运行后续步骤时可以去掉以下四句测试代码
print("测试工具输出：")
print(get_current_weather({"location": "上海"}))
print(get_current_time())
print("\n")
```

Node.js

```
// 步骤1:定义工具函数

// 导入时间查询工具
import { format } from 'date-fns';

function getCurrentWeather(args) {
    // 定义备选的天气条件列表
    const weatherConditions = ["晴天", "多云", "雨天"];
    // 随机选择一个天气条件
    const randomWeather = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
    // 从 JSON 中提取位置信息
    const location = args.location;
    // 返回格式化的天气信息
    return `${location}今天是${randomWeather}。`;
}

function getCurrentTime() {
    // 获取当前日期和时间
    const currentDatetime = new Date();
    // 格式化当前日期和时间
    const formattedTime = format(currentDatetime, 'yyyy-MM-dd HH:mm:ss');
    // 返回格式化后的当前时间
    return `当前时间：${formattedTime}。`;
}

// 测试工具函数并输出结果，运行后续步骤时可以去掉以下四句测试代码
console.log("测试工具输出：")
console.log(getCurrentWeather({location:"上海"}));
console.log(getCurrentTime());
console.log("\n")
```

运行工具后，得到输出：

```
测试工具输出：
上海今天是多云。
当前时间：2025-01-08 20:21:45。
```

#### **1.2 创建 tools 数组**

人类在选择工具之前，需要对工具有全面的了解，包括工具的功能、何时使用以及输入参数等。大模型也需要这些信息才能更准确地选择工具。请根据以下 JSON 格式提供工具信息。

| - `type`字段固定为`"function"`； - `function`字段为 Object 类型； - `name`字段为自定义的工具函数名称，建议使用与函数相同的名称，如`get_current_weather`或`get_current_time`； - `description`字段是对工具函数功能的描述，大模型会参考该字段来选择是否使用该工具函数。 - `parameters`字段是对工具函数入参的描述，类型是 Object ，大模型会参考该字段来进行入参的提取。如果工具函数不需要输入参数，则无需指定`parameters`参数。 - `type`字段固定为`"object"`； - `properties`字段描述了入参的名称、数据类型与描述，为 Object 类型，Key 值为入参的名称，Value 值为入参的数据类型与描述； - `required`字段指定哪些参数为必填项，为 Array 类型。 | 对于天气查询工具来说，工具描述信息的格式如下： ``` { "type": "function", "function": { "name": "get_current_weather", "description": "当你想查询指定城市的天气时非常有用。", "parameters": { "type": "object", "properties": { "location": { "type": "string", "description": "城市或县区，比如北京市、杭州市、余杭区等。" } }, "required": ["location"] } } } ``` |
| --- | --- |

在发起 Function Calling 前，需在代码中定义工具信息数组（tools），包含每个工具的函数名、描述和参数定义。这个数组在后续发起Function Calling请求时作为参数传入。

Python

```
# 请将以下代码粘贴到步骤1代码后

## 步骤2:创建 tools 数组

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "当你想知道现在的时间时非常有用。",
            "parameters": {}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。",
                    }
                },
                "required": ["location"]
            }
        }
    }
]
tool_name = [tool["function"]["name"] for tool in tools]
print(f"创建了{len(tools)}个工具，为：{tool_name}\n")
```

Node.js

```
// 请将以下代码粘贴到步骤1代码后

// 步骤2:创建 tools 数组

const tools = [
    {
      type: "function",
      function: {
        name: "get_current_time",
        description: "当你想知道现在的时间时非常有用。",
        parameters: {}
      }
    },
    {
      type: "function",
      function: {
        name: "get_current_weather",
        description: "当你想查询指定城市的天气时非常有用。",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "城市或县区，比如北京市、杭州市、余杭区等。",
            }
          },
          required: ["location"]
        }
      }
    }
  ];
  
const toolNames = tools.map(tool => tool.function.name);
console.log(`创建了${tools.length}个工具，为：${toolNames.join(', ')}\n`);
```

### **2\. 创建messages数组**

Function Calling 通过 messages 数组向大模型传入指令与上下文信息。发起 Function Calling 前，messages 数组需要包含 System Message 与 User Message。

#### **System Message**

尽管在[创建 tools 数组](#b7c8a0e72a9d0)时已经对工具的作用与何时使用工具进行了描述，但在 System Message 中强调何时调用工具通常会提高工具调用的准确率。在当前场景下，可以将 System Prompt 设置为：

```
你是一个很有帮助的助手。如果用户提问关于天气的问题，请调用 ‘get_current_weather’ 函数;
如果用户提问关于时间的问题，请调用‘get_current_time’函数。
请以友好的语气回答问题。
```

#### **User Message**

User Message 用于传入用户提问的问题。假设用户提问“上海天气”，此时的 messages 数组为：

Python

```
# 步骤3:创建messages数组
# 请将以下代码粘贴到步骤2 代码后
# 文本生成模型的 User Message示例
messages = [
    {
        "role": "system",
        "content": """你是一个很有帮助的助手。如果用户提问关于天气的问题，请调用 ‘get_current_weather’ 函数;
     如果用户提问关于时间的问题，请调用‘get_current_time’函数。
     请以友好的语气回答问题。""",
    },
    {
        "role": "user",
        "content": "上海天气"
    }
]

# 多模态模型的 User Message示例
# messages=[
#  {
#         "role": "system",
#         "content": """你是一个很有帮助的助手。如果用户提问关于天气的问题，请调用 ‘get_current_weather’ 函数;
#      如果用户提问关于时间的问题，请调用‘get_current_time’函数。
#      请以友好的语气回答问题。""",
#     },
#     {"role": "user",
#      "content": [{"type": "image_url","image_url": {"url": "https://img.alicdn.com/imgextra/i2/O1CN01FbTJon1ErXVGMRdsN_!!6000000000405-0-tps-1024-683.jpg"}},
#                  {"type": "text", "text": "根据图像上的地点，查询该地点当前天气"}]},
# ]

print("messages 数组创建完成\n") 
```

Node.js

```
// 步骤3:创建messages数组
// 请将以下代码粘贴到步骤2 代码后
const messages = [
    {
        role: "system",
        content: "你是一个很有帮助的助手。如果用户提问关于天气的问题，请调用 ‘get_current_weather’ 函数; 如果用户提问关于时间的问题，请调用‘get_current_time’函数。请以友好的语气回答问题。",
    },
    {
        role: "user",
        content: "上海天气"
    }
];
// 多模态模型的 User Message示例，
// const messages: [{
//     role: "user",
//     content: [{type: "image_url", image_url: {"url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241022/emyrja/dog_and_girl.jpeg"}},
//               {type: "text", text: "图中描绘的是什么景象?"}]
//   }];

console.log("messages 数组创建完成\n");
```

> 由于备选工具包含天气查询与时间查询，也可提问关于当前时间的问题。

### **3\. 发起 Function Calling**

将创建好的 `tools` 与 `messages` 传入大模型，即可发起一次 Function Calling。大模型会判断是否调用工具。若调用，则返回该工具的函数名与参数。

> 支持的模型参见[支持的模型](#c8feada2328us)。

Python

```
# 步骤4:发起 function calling
# 请将以下代码粘贴到步骤3 代码后

from openai import OpenAI
import os

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

def function_calling():
    completion = client.chat.completions.create(
        model="qwen-plus",  # 此处以qwen-plus为例，可按需更换模型名称。模型列表：https://help.aliyun.com/zh/model-studio/getting-started/models
        messages=messages,
        tools=tools
    )
    print("返回对象：")
    print(completion.choices[0].message.model_dump_json())
    print("\n")
    return completion

print("正在发起function calling...")
completion = function_calling()
```

Node.js

```
// 步骤4:发起 function calling
// 请将以下代码粘贴到步骤3 代码后

import OpenAI from "openai";
const openai = new OpenAI(
    {
        // 若没有配置环境变量，请用百炼API Key将下行替换为：apiKey: "sk-xxx",
        // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
        apiKey: process.env.DASHSCOPE_API_KEY,
        // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
);

async function functionCalling() {
    const completion = await openai.chat.completions.create({
        model: "qwen-plus",  // 此处以qwen-plus为例，可按需更换模型名称。模型列表：https://help.aliyun.com/zh/model-studio/getting-started/models
        messages: messages,
        tools: tools
    });
    console.log("返回对象：");
    console.log(JSON.stringify(completion.choices[0].message));
    console.log("\n");
    return completion;
}

const completion = await functionCalling();
```

由于用户提问为上海天气，大模型指定需要使用的工具函数名称为：`"get_current_weather"`，函数的入参为：`"{\"location\": \"上海\"}"`。

```
{
    "content": "",
    "refusal": null,
    "role": "assistant",
    "audio": null,
    "function_call": null,
    "tool_calls": [
        {
            "id": "call_6596dafa2a6a46f7a217da",
            "function": {
                "arguments": "{\"location\": \"上海\"}",
                "name": "get_current_weather"
            },
            "type": "function",
            "index": 0
        }
    ]
}
```

需要注意，如果问题被大模型判断为无需使用工具，会通过`content`参数直接回复。在输入“你好”时，`tool_calls`参数为空，返回对象格式为：

```
{
    "content": "你好！有什么可以帮助你的吗？如果你有关于天气或者时间的问题，我特别擅长回答。",
    "refusal": null,
    "role": "assistant",
    "audio": null,
    "function_call": null,
    "tool_calls": null
}
```

> 如果`tool_calls` 参数为空，可使程序直接返回 `content`，无需运行以下步骤。

> 若希望每次发起 Function Calling 后大模型都可以选择指定工具，请参见[强制工具调用](#b0910669927j7)。

### **4\. 运行工具函数**

运行工具函数是将大模型的决策转化为实际操作的关键步骤。

> 运行工具函数的过程由您的计算环境而非大模型来完成。

由于大模型只可以输出字符串格式的内容，因此在运行工具函数前，需要对字符串格式的工具函数与入参分别解析。

-   工具函数
    
    建立一个**工具函数名称**到**工具函数实体**的映射`function_mapper`，将返回的工具函数字符串映射到工具函数实体；
    
-   入参
    
    Function Calling 返回的入参为 JSON 字符串，使用工具将其解析为 JSON 对象，提取入参信息。
    

完成解析后，将参数传入工具函数并执行，获取输出结果。

Python

```
# 步骤5:运行工具函数
# 请将以下代码粘贴到步骤4 代码后
import json

print("正在执行工具函数...")
# 从返回的结果中获取函数名称和入参
function_name = completion.choices[0].message.tool_calls[0].function.name
arguments_string = completion.choices[0].message.tool_calls[0].function.arguments

# 使用json模块解析参数字符串
arguments = json.loads(arguments_string)
# 创建一个函数映射表
function_mapper = {
    "get_current_weather": get_current_weather,
    "get_current_time": get_current_time
}
# 获取函数实体
function = function_mapper[function_name]
# 如果入参为空，则直接调用函数
if arguments == {}:
    function_output = function()
# 否则，传入参数后调用函数
else:
    function_output = function(arguments)
# 打印工具的输出
print(f"工具函数输出：{function_output}\n")
```

Node.js

```
// 步骤5:运行工具函数
// 请将以下代码粘贴到步骤4 代码后

console.log("正在执行工具函数...");
const function_name = completion.choices[0].message.tool_calls[0].function.name;
const arguments_string = completion.choices[0].message.tool_calls[0].function.arguments;

// 使用JSON模块解析参数字符串
const args = JSON.parse(arguments_string);

// 创建一个函数映射表
const functionMapper = {
    "get_current_weather": getCurrentWeather,
    "get_current_time": getCurrentTime
};

// 获取函数实体
const func = functionMapper[function_name];

// 如果入参为空，则直接调用函数
let functionOutput;
if (Object.keys(args).length === 0) {
    functionOutput = func();
} else {
    // 否则，传入参数后调用函数
    functionOutput = func(args);
}

// 打印工具的输出
console.log(`工具函数输出：${functionOutput}\n`);
```

运行后得到如下输出：

```
上海今天是多云。
```

**说明**

在实际业务场景中，许多工具的核心功能是执行具体操作（如邮件发送、文件上传等），而非数据查询，这类工具执行后不会输出字符串。为帮助大模型了解工具运行状态，建议在设计此类工具时添加如“邮件发送完成”、"操作执行失败"等状态描述信息。

### **5\. 大模型总结工具函数输出**

工具函数的输出格式较为固定，如果直接返回给用户，可能会有语气生硬、不够灵活等问题。如果您希望大模型能够综合用户输入以及工具输出结果，生成自然语言风格的回复，可以将工具输出提交到模型上下文并再次向模型发出请求。

1.  添加 Assistant Message
    
    [发起 Function Calling](#9f478b2e76wrk)后，通过`completion.choices[0].message`得到 Assistant Message，首先将它添加到 messages 数组中；
    
2.  添加 Tool Message
    
    将工具的输出通过`{"role": "tool", "content": "工具的输出","tool_call_id": completion.choices[0].message.tool_calls[0].id}`形式添加到 messages 数组。
    
    **说明**
    
    -   请确保工具的输出为字符串格式。
        
    -   `tool_call_id` 是系统为每一次的工具调用请求生成的**唯一标识符**。模型可能一次性要求调用多个工具，将多个工具结果返回给模型时，`tool_call_id`可确保工具的输出结果能够与它的调用意图对应。
        
    

Python

```
# 步骤6:向大模型提交工具输出
# 请将以下代码粘贴到步骤5 代码后

messages.append(completion.choices[0].message)
print("已添加assistant message")
messages.append({"role": "tool", "content": function_output, "tool_call_id": completion.choices[0].message.tool_calls[0].id})
print("已添加tool message\n")
```

Node.js

```
// 步骤6:向大模型提交工具输出
// 请将以下代码粘贴到步骤5 代码后

messages.push(completion.choices[0].message);
console.log("已添加 assistant message")
messages.push({
    "role": "tool",
    "content": functionOutput,
    "tool_call_id": completion.choices[0].message.tool_calls[0].id
});
console.log("已添加 tool message\n");
```

此时的 messages 数组为：

```
[
  System Message -- 指引模型调用工具的策略
  User Message -- 用户的问题
  Assistant Message -- 模型返回的工具调用信息
  Tool Message -- 工具的输出信息（如果采用下文介绍的并行工具调用，可能有多个 Tool Message）
]
```

更新 messages 数组后，运行以下代码。

Python

```
# 步骤7:大模型总结工具输出
# 请将以下代码粘贴到步骤6 代码后
print("正在总结工具输出...")
completion = function_calling()
```

Node.js

```
// 步骤7:大模型总结工具输出
// 请将以下代码粘贴到步骤6 代码后

console.log("正在总结工具输出...");
const completion_1 = await functionCalling();
```

可从`content`得到回复内容：“上海今天的天气是多云。如果您有其他问题，欢迎继续提问。”

```
{
    "content": "上海今天的天气是多云。如果您有其他问题，欢迎继续提问。",
    "refusal": null,
    "role": "assistant",
    "audio": null,
    "function_call": null,
    "tool_calls": null
}
```

至此，您已完成了一次完整的 Function Calling 流程。

## **进阶用法**

### **指定工具调用方式**

#### **并行工具调用**

单一城市的天气查询经过一次工具调用即可。如果输入问题需要调用多次工具，如“北京上海的天气如何”或“杭州天气，以及现在几点了”，[发起 Function Calling](#9f478b2e76wrk) 后只会返回一个工具调用信息，以提问“北京上海的天气如何”为例：

```
{
    "content": "",
    "refusal": null,
    "role": "assistant",
    "audio": null,
    "function_call": null,
    "tool_calls": [
        {
            "id": "call_61a2bbd82a8042289f1ff2",
            "function": {
                "arguments": "{\"location\": \"北京市\"}",
                "name": "get_current_weather"
            },
            "type": "function",
            "index": 0
        }
    ]
}
```

返回结果中只有北京市的入参信息。为了解决这一问题，在[发起 Function Calling](#9f478b2e76wrk)时，可设置请求参数`parallel_tool_calls`为`true`，这样返回对象中将包含所有需要调用的工具函数与入参信息。

**说明**

并行工具调用适合任务之间无依赖的情况。若任务之间有依赖关系（工具A的输入与工具B的输出结果有关），请参见[快速开始](#dd5a3dca390k9)，通过while循环实现串行工具调用（一次调用一个工具）。

Python

```
def function_calling():
    completion = client.chat.completions.create(
        model="qwen-plus",  # 此处以 qwen-plus 为例，可按需更换模型名称
        messages=messages,
        tools=tools,
        # 新增参数
        parallel_tool_calls=True
    )
    print("返回对象：")
    print(completion.choices[0].message.model_dump_json())
    print("\n")
    return completion

print("正在发起function calling...")
completion = function_calling()
```

Node.js

```
async function functionCalling() {
    const completion = await openai.chat.completions.create({
        model: "qwen-plus",  // 此处以qwen-plus为例，可按需更换模型名称
        messages: messages,
        tools: tools,
        parallel_tool_calls: true
    });
    console.log("返回对象：");
    console.log(JSON.stringify(completion.choices[0].message));
    console.log("\n");
    return completion;
}

const completion = await functionCalling();
```

在返回对象的`tool_calls`数组中包含了北京上海的入参信息：

```
{
    "content": "",
    "role": "assistant",
    "tool_calls": [
        {
            "function": {
                "name": "get_current_weather",
                "arguments": "{\"location\": \"北京市\"}"
            },
            "index": 0,
            "id": "call_c2d8a3a24c4d4929b26ae2",
            "type": "function"
        },
        {
            "function": {
                "name": "get_current_weather",
                "arguments": "{\"location\": \"上海市\"}"
            },
            "index": 1,
            "id": "call_dc7f2f678f1944da9194cd",
            "type": "function"
        }
    ]
}
```

#### **强制工具调用**

大模型生成内容具有不确定性，有时会选择错误的工具进行调用。如果您希望对于某一类问题，大模型能够采取人为设定的策略（如强制使用某个工具、强制不使用工具），可修改`tool_choice`参数。`tool_choice`参数的默认值为`"auto"`，表示由大模型自主判断如何进行工具调用。

> 大模型总结工具函数输出时，请将`tool_choice`参数去除，否则 API 仍会返回工具调用信息。

-   **强制使用某个工具**
    
    如果您希望对于某一类问题，Function Calling 能强制调用某个工具，可设定`tool_choice`参数为`{"type": "function", "function": {"name": "the_function_to_call"}}`，大模型将不参与工具的选择，只输出入参信息。
    
    假设当前场景中只包含天气查询的问题，可修改 function\_calling 代码为：
    
    Python
    
    ```
    def function_calling():
        completion = client.chat.completions.create(
            model="qwen-plus",
            messages=messages,
            tools=tools,
            tool_choice={"type": "function", "function": {"name": "get_current_weather"}}
        )
        print(completion.model_dump_json())
    
    function_calling()
    ```
    
    Node.js
    
    ```
    async function functionCalling() {
        const response = await openai.chat.completions.create({
            model: "qwen-plus",
            messages: messages,
            tools: tools,
            tool_choice: {"type": "function", "function": {"name": "get_current_weather"}}
        });
        console.log("返回对象：");
        console.log(JSON.stringify(response.choices[0].message));
        console.log("\n");
        return response;
    }
    
    const response = await functionCalling();
    ```
    
    无论输入什么问题，返回对象的工具函数都会是`get_current_weather`。
    
    > 使用该策略前请确保问题与选择的工具相关，否则可能返回不符合预期的结果。
    
-   **强制不使用工具**
    
    如果您希望无论输入什么问题，Function Calling 都不会进行工具调用（返回对象中包含回复内容`content`而`tool_calls`参数为空），可设定`tool_choice`参数为`"none"`，或不传入`tools`参数，Function Calling 返回的`tool_calls`参数将始终为空。
    
    假设当前场景中的问题均无需调用工具，可修改 function\_calling 代码为：
    
    Python
    
    ```
    def function_calling():
        completion = client.chat.completions.create(
            model="qwen-plus",
            messages=messages,
            tools=tools,
            tool_choice="none"
        )
        print(completion.model_dump_json())
    
    function_calling()
    ```
    
    Node.js
    
    ```
    async function functionCalling() {
        const completion = await openai.chat.completions.create({
            model: "qwen-plus",
            messages: messages,
            tools: tools,
            tool_choice: "none"
        });
        console.log("返回对象：");
        console.log(JSON.stringify(completion.choices[0].message));
        console.log("\n");
        return completion;
    }
    
    const completion = await functionCalling();
    ```
    

### **多轮对话**

用户可能在第一轮提问“北京天气”，第二轮提问“上海的呢？”若模型上下文中没有第一轮的信息，模型无法判断需要调用哪个工具。建议在多轮对话场景中，每轮结束后维持 messages 数组，在此基础上添加 User Message并[发起 Function Calling](#9f478b2e76wrk)以及后续步骤。messages 结构如下所示：

```
[
  System Message -- 指引模型调用工具的策略
  User Message -- 用户的问题
  Assistant Message -- 模型返回的工具调用信息
  Tool Message -- 工具的输出信息
  Assistant Message -- 模型总结的工具调用信息
  User Message -- 用户第二轮的问题
]
```

### **流式输出**

为了提升用户体验和减少等待时间，可使用流式输出实时获取工具函数名称与入参信息。其中：

-   工具调用的参数信息：以数据流的形式分块返回。
    
-   工具函数名称：在流式响应的第一个数据块中返回。
    

Python

```
from openai import OpenAI
import os

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。",
                    }
                },
                "required": ["location"],
            },
        },
    },
]

stream = client.chat.completions.create(
    model="qwen-plus",
    messages=[{"role": "user", "content": "杭州天气?"}],
    tools=tools,
    stream=True
)

for chunk in stream:
    delta = chunk.choices[0].delta
    print(delta.tool_calls)
```

Node.js

```
import { OpenAI } from "openai";

const openai = new OpenAI(
    {
        // 若没有配置环境变量，请用百炼API Key将下行替换为：apiKey: "sk-xxx",
        // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
        apiKey: process.env.DASHSCOPE_API_KEY,
        // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
);
const tools = [
    {
        "type": "function",
        "function": {
            "name": "getCurrentWeather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]
            }
        }
    }
];

const stream = await openai.chat.completions.create({
    model: "qwen-plus",
    messages: [{ role: "user", content: "北京天气" }],
    tools: tools,
    stream: true,
});

for await (const chunk of stream) {
    const delta = chunk.choices[0].delta;
    console.log(delta.tool_calls);
}
```

运行后得到如下输出：

```
[ChoiceDeltaToolCall(index=0, id='call_8f08d2b0fc0c4d8fab7123', function=ChoiceDeltaToolCallFunction(arguments='{"location":', name='get_current_weather'), type='function')]
[ChoiceDeltaToolCall(index=0, id='', function=ChoiceDeltaToolCallFunction(arguments=' "杭州"}', name=None), type='function')]
None
```

运行以下代码拼接入参信息（`arguments`）：

Python

```
tool_calls = {}
for response_chunk in stream:
    delta_tool_calls = response_chunk.choices[0].delta.tool_calls
    if delta_tool_calls:
        for tool_call_chunk in delta_tool_calls:
            call_index = tool_call_chunk.index
            tool_call_chunk.function.arguments = tool_call_chunk.function.arguments or ""
            if call_index not in tool_calls:
                tool_calls[call_index] = tool_call_chunk
            else:
                tool_calls[call_index].function.arguments += tool_call_chunk.function.arguments
print(tool_calls[0].model_dump_json())
```

Node.js

```
const toolCalls = {};
for await (const responseChunk of stream) {
  const deltaToolCalls = responseChunk.choices[0]?.delta?.tool_calls;
  if (deltaToolCalls) {
    for (const toolCallChunk of deltaToolCalls) {
      const index = toolCallChunk.index;
      toolCallChunk.function.arguments = toolCallChunk.function.arguments || "";
      if (!toolCalls[index]) {
        toolCalls[index] = { ...toolCallChunk };
        if (!toolCalls[index].function) {
            toolCalls[index].function = { name: '', arguments: '' };
        }
      } 
      else if (toolCallChunk.function?.arguments) {
        toolCalls[index].function.arguments += toolCallChunk.function.arguments;
      }
    }
  }
}
console.log(JSON.stringify(toolCalls[0]));
```

获得如下输出：

```
{"index":0,"id":"call_16c72bef988a4c6c8cc662","function":{"arguments":"{\"location\": \"杭州\"}","name":"get_current_weather"},"type":"function"}
```

在使用大模型总结工具函数输出步骤，添加的 Assistant Message 需要符合下方格式。仅需将下方的`tool_calls`中的元素替换为以上内容即可。

```
{
    "content": "",
    "refusal": None,
    "role": "assistant",
    "audio": None,
    "function_call": None,
    "tool_calls": [
        {
            "id": "call_xxx",
            "function": {
                "arguments": '{"location": "xx"}',
                "name": "get_current_weather",
            },
            "type": "function",
            "index": 0,
        }
    ],
}
```

### **Responses API 的工具调用**

上述示例均基于 OpenAI Chat Completions 与DashScope API实现工具调用。若使用 OpenAI Responses API，工具调用的整体流程相同，但在接口格式上有以下区别：

| **维度** | **Chat Completions** | **Responses API** |
| --- | --- | --- |
| base\\_url | https://dashscope.aliyuncs.com/compatible-mode/v1 | https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1 |
| 工具定义格式 | ``` { "type": "function", "function": { "name":..., "parameters":... } } ``` | ``` { "type": "function", "name":..., "parameters":... } ``` |
| 工具调用输出 | response.choices\\[0\\].message.tool\\_calls | response.output 中 type 为 function\\_call 的项 |
| 工具结果回传 | ``` { "role": "tool", "tool_call_id":..., "content":... } ``` | ``` { "type": "function_call_output", "call_id":..., "output":... } ``` |
| 最终回复 | response.choices\\[0\\].message.content | response.output\\_text |

Python

```
from openai import OpenAI
import json
import os
import random

# 初始化客户端
client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
)
# 模拟用户问题
USER_QUESTION = "北京天气咋样"
# 定义工具列表
tools = [
    {
        "type": "function",
        "name": "get_current_weather",
        "description": "当你想查询指定城市的天气时非常有用。",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "城市或县区，比如北京市、杭州市、余杭区等。",
                }
            },
            "required": ["location"],
        },
    }
]


# 模拟天气查询工具
def get_current_weather(arguments):
    weather_conditions = ["晴天", "多云", "雨天"]
    random_weather = random.choice(weather_conditions)
    location = arguments["location"]
    return f"{location}今天是{random_weather}。"


# 封装模型响应函数
def get_response(input_data):
    response = client.responses.create(
        model="qwen3.5-plus",  # 可选：qwen3.5-flash、qwen3.5-flash-2026-02-23
        input=input_data,
        tools=tools,
    )
    return response


# 维护对话上下文
conversation = [{"role": "user", "content": USER_QUESTION}]

response = get_response(conversation)
function_calls = [item for item in response.output if item.type == "function_call"]
# 如果不需要调用工具，直接输出内容
if not function_calls:
    print(f"助手最终回复：{response.output_text}")
else:
    # 进入工具调用循环
    while function_calls:
        for fc in function_calls:
            func_name = fc.name
            arguments = json.loads(fc.arguments)
            print(f"正在调用工具 [{func_name}]，参数：{arguments}")
            # 执行工具
            tool_result = get_current_weather(arguments)
            print(f"工具返回：{tool_result}")
            # 将工具调用和结果成对追加到上下文中
            conversation.append(
                {
                    "type": "function_call",
                    "name": fc.name,
                    "arguments": fc.arguments,
                    "call_id": fc.call_id,
                }
            )
            conversation.append(
                {
                    "type": "function_call_output",
                    "call_id": fc.call_id,
                    "output": tool_result,
                }
            )
        # 携带完整上下文再次调用模型
        response = get_response(conversation)
        function_calls = [
            item for item in response.output if item.type == "function_call"
        ]
    print(f"助手最终回复：{response.output_text}")
```

Node.js

```
import OpenAI from "openai";

// 初始化客户端
const openai = new OpenAI({
  // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
  // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL:
    "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
});

// 定义工具列表
const tools = [
  {
    type: "function",
    name: "get_current_weather",
    description: "当你想查询指定城市的天气时非常有用。",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "城市或县区，比如北京市、杭州市、余杭区等。",
        },
      },
      required: ["location"],
    },
  },
];

// 模拟天气查询工具
const getCurrentWeather = (args) => {
  const weatherConditions = ["晴天", "多云", "雨天"];
  const randomWeather =
    weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
  const location = args.location;
  return `${location}今天是${randomWeather}。`;
};

// 封装模型响应函数
const getResponse = async (inputData) => {
  const response = await openai.responses.create({
    model: "qwen3.5-plus",  // 可选：qwen3.5-flash、qwen3.5-flash-2026-02-23
    input: inputData,
    tools: tools,
  });
  return response;
};

const main = async () => {
  const userQuestion = "北京天气";

  // 维护对话上下文
  const conversation = [{ role: "user", content: userQuestion }];

  let response = await getResponse(conversation);
  let functionCalls = response.output.filter(
    (item) => item.type === "function_call"
  );
  // 如果不需要调用工具，直接输出内容
  if (functionCalls.length === 0) {
    console.log(`助手最终回复：${response.output_text}`);
  } else {
    // 进入工具调用循环
    while (functionCalls.length > 0) {
      for (const fc of functionCalls) {
        const funcName = fc.name;
        const args = JSON.parse(fc.arguments);
        console.log(`正在调用工具 [${funcName}]，参数：`, args);
        // 执行工具
        const toolResult = getCurrentWeather(args);
        console.log(`工具返回：${toolResult}`);
        // 将工具调用和结果成对追加到上下文中
        conversation.push({
          type: "function_call",
          name: fc.name,
          arguments: fc.arguments,
          call_id: fc.call_id,
        });
        conversation.push({
          type: "function_call_output",
          call_id: fc.call_id,
          output: toolResult,
        });
      }
      // 携带完整上下文再次调用模型
      response = await getResponse(conversation);
      functionCalls = response.output.filter(
        (item) => item.type === "function_call"
      );
    }
    console.log(`助手最终回复：${response.output_text}`);
  }
};

// 启动程序
main().catch(console.error);
```

### **Qwen3-Omni-Flash模型的工具调用**

在**获取工具信息阶段**，`Qwen3-Omni-Flash`模型的使用方式与其他模型有以下不同：

-   **必须使用流式输出：**`Qwen3-Omni-Flash`仅支持流式输出，在获取工具信息时也必须设置 `stream=True`。
    
-   **建议仅输出文本：**模型在获取工具信息（函数的名称和参数）时仅需文本信息，为避免生成不必要的音频，建议设置 `modalities=["text"]`。当输出包含文本和音频两种模态时，获取工具信息时需要跳过音频数据块。
    

> Qwen3-Omni-Flash详情参见：[非实时（Qwen-Omni）](https://help.aliyun.com/zh/model-studio/qwen-omni)。

Python

```
from openai import OpenAI
import os

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。",
                    }
                },
                "required": ["location"],
            },
        },
    },
]

completion = client.chat.completions.create(
    model="qwen3-omni-flash",
    messages=[{"role": "user", "content": "杭州天气?"}],

    # 设置输出数据的模态，可取值：["text"]、["text","audio"]，建议设置为["text"]
    modalities=["text"],
    
    # stream 必须设置为 True，否则会报错
    stream=True,
    tools=tools
)

for chunk in completion:
    # 如果输出包含音频模态，请将下列条件改为：if chunk.choices and not hasattr(chunk.choices[0].delta, "audio"): 
    if chunk.choices:
        delta = chunk.choices[0].delta
        print(delta.tool_calls)
```

Node.js

```
import { OpenAI } from "openai";

const openai = new OpenAI(
    {
        // 若没有配置环境变量，请用百炼API Key将下行替换为：apiKey: "sk-xxx",
        // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
        apiKey: process.env.DASHSCOPE_API_KEY,
        // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
);

const tools = [
    {
        "type": "function",
        "function": {
            "name": "getCurrentWeather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]
            }
        }
    }
];

const stream = await openai.chat.completions.create({
    model: "qwen3-omni-flash",
    messages: [
        {
            "role": "user",
            "content": "杭州天气"
        }],
    stream: true,
    // 设置输出数据的模态，可取值：["text"]、["text","audio"]，建议设置为["text"]
    modalities: ["text"],
    tools:tools
});

for await (const chunk of stream) {
    // 如果输出包含音频，请将条件语句替换为：if (chunk.choices?.length && chunk.choices[0].delta && !('audio' in chunk.choices[0].delta))
    const delta = chunk.choices[0].delta;
    console.log(delta.tool_calls);
}
```

运行后得到如下输出：

```
[ChoiceDeltaToolCall(index=0, id='call_391c8e5787bc4972a388aa', function=ChoiceDeltaToolCallFunction(arguments=None, name='get_current_weather'), type='function')]
[ChoiceDeltaToolCall(index=0, id='call_391c8e5787bc4972a388aa', function=ChoiceDeltaToolCallFunction(arguments=' {"location": "杭州市"}', name=None), type='function')]
None
```

拼接入参信息（`arguments`）的代码请参见[流式输出](#ee24b4ca07c53)。

### **深度思考模型的工具调用**

深度思考模型在输出工具调用信息前会进行思考，可以提升决策的可解释性与可靠性。

1.  **思考过程**
    
    模型逐步分析用户意图、识别所需工具、验证参数合法性，并规划调用策略；
    
2.  **工具调用**
    
    模型以结构化格式输出一个或多个函数调用请求。
    
    > 支持并行工具调用。
    

以下展示流式调用深度思考模型的工具调用示例。

> 文本生成思考模型请参见：[深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)；多模态思考模型请参见：[图像与视频理解](https://help.aliyun.com/zh/model-studio/vision)、[非实时（Qwen-Omni）](https://help.aliyun.com/zh/model-studio/qwen-omni)。

> `tool_choice`参数只支持设置为`"auto"`（默认值，表示由模型自主选择工具）或`"none"`（强制模型不选择工具）。

## OpenAI兼容

## Python

### **示例代码**

```
import os
from openai import OpenAI

# 初始化OpenAI客户端，配置阿里云DashScope服务
client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 从环境变量读取API密钥
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

# 定义可用工具列表
tools = [
    # 工具1 获取当前时刻的时间
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "当你想知道现在的时间时非常有用。",
            "parameters": {}  # 无需参数
        }
    },  
    # 工具2 获取指定城市的天气
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {  
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]  # 必填参数
            }
        }
    }
]

messages = [{"role": "user", "content": input("请输入问题：")}]

# 多模态模型的 message示例
# messages = [{
#     "role": "user",
#     "content": [
#              {"type": "image_url","image_url": {"url": "https://img.alicdn.com/imgextra/i4/O1CN014CJhzi20NOzo7atOC_!!6000000006837-2-tps-2048-1365.png"}},
#              {"type": "text", "text": "根据图像上的地点，请问该地点当前的天气"}]
#     }]

completion = client.chat.completions.create(
    # 此处以qwen-plus为例，可更换为其它深度思考模型
    model="qwen-plus",
    messages=messages,
    extra_body={
        # 开启深度思考
        "enable_thinking": True
    },
    tools=tools,
    parallel_tool_calls=True,
    stream=True,
    # 解除注释后，可以获取到token消耗信息
    # stream_options={
    #     "include_usage": True
    # }
)

reasoning_content = ""  # 定义完整思考过程
answer_content = ""     # 定义完整回复
tool_info = []          # 存储工具调用信息
is_answering = False   # 判断是否结束思考过程并开始回复
print("="*20+"思考过程"+"="*20)
for chunk in completion:
    if not chunk.choices:
        # 处理用量统计信息
        print("\n"+"="*20+"Usage"+"="*20)
        print(chunk.usage)
    else:
        delta = chunk.choices[0].delta
        # 处理AI的思考过程（链式推理）
        if hasattr(delta, 'reasoning_content') and delta.reasoning_content is not None:
            reasoning_content += delta.reasoning_content
            print(delta.reasoning_content,end="",flush=True)  # 实时输出思考过程
            
        # 处理最终回复内容
        else:
            if not is_answering:  # 首次进入回复阶段时打印标题
                is_answering = True
                print("\n"+"="*20+"回复内容"+"="*20)
            if delta.content is not None:
                answer_content += delta.content
                print(delta.content,end="",flush=True)  # 流式输出回复内容
            
            # 处理工具调用信息（支持并行工具调用）
            if delta.tool_calls is not None:
                for tool_call in delta.tool_calls:
                    index = tool_call.index  # 工具调用索引，用于并行调用
                    
                    # 动态扩展工具信息存储列表
                    while len(tool_info) <= index:
                        tool_info.append({})
                    
                    # 收集工具调用ID（用于后续函数调用）
                    if tool_call.id:
                        tool_info[index]['id'] = tool_info[index].get('id', '') + tool_call.id
                    
                    # 收集函数名称（用于后续路由到具体函数）
                    if tool_call.function and tool_call.function.name:
                        tool_info[index]['name'] = tool_info[index].get('name', '') + tool_call.function.name
                    
                    # 收集函数参数（JSON字符串格式，需要后续解析）
                    if tool_call.function and tool_call.function.arguments:
                        tool_info[index]['arguments'] = tool_info[index].get('arguments', '') + tool_call.function.arguments
            
print(f"\n"+"="*19+"工具调用信息"+"="*19)
if not tool_info:
    print("没有工具调用")
else:
    print(tool_info)
```

### **返回结果**

输入“四个直辖市的天气”，得到以下返回结果：

```
====================思考过程====================
好的，用户问的是“四个直辖市的天气”。首先，我需要明确四个直辖市是哪几个。根据中国的行政区划，直辖市包括北京、上海、天津和重庆。所以用户想知道这四个城市的天气情况。

接下来，我需要检查可用的工具。提供的工具中有get_current_weather函数，参数是location，类型字符串。每个城市需要单独查询，因为函数一次只能查一个地点。因此，我需要为每个直辖市调用一次这个函数。

然后，我需要考虑如何生成正确的工具调用。每个调用应该包含城市名称作为参数。比如，第一个调用是北京，第二个是上海，依此类推。确保参数名称是location，值是正确的城市名。

另外，用户可能希望得到每个城市的天气信息，所以需要确保每个函数调用都正确无误。可能需要连续调用四次，每次对应一个城市。不过，根据工具的使用规则，可能需要分多次处理，或者一次生成多个调用。但根据示例，可能每次只调用一个函数，所以可能需要逐步进行。

最后，确认是否有其他需要考虑的因素，比如参数是否正确，城市名称是否准确，以及是否需要处理可能的错误情况，比如城市不存在或API不可用。但目前看来，四个直辖市都是明确的，应该没问题。
====================回复内容====================

===================工具调用信息===================
[{'id': 'call_767af2834c12488a8fe6e3', 'name': 'get_current_weather', 'arguments': '{"location": "北京市"}'}, {'id': 'call_2cb05a349c89437a947ada', 'name': 'get_current_weather', 'arguments': '{"location": "上海市"}'}, {'id': 'call_988dd180b2ca4b0a864ea7', 'name': 'get_current_weather', 'arguments': '{"location": "天津市"}'}, {'id': 'call_4e98c57ea96a40dba26d12', 'name': 'get_current_weather', 'arguments': '{"location": "重庆市"}'}]
```

## Node.js

### **示例代码**

```
import OpenAI from "openai";
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const openai = new OpenAI({
    // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    apiKey: process.env.DASHSCOPE_API_KEY,
    // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const tools = [
    {
        type: "function",
        function: {
            name: "get_current_time",
            description: "当你想知道现在的时间时非常有用。",
            parameters: {}
        }
    },
    {
        type: "function",
        function: {
            name: "get_current_weather",
            description: "当你想查询指定城市的天气时非常有用。",
            parameters: {
                type: "object",
                properties: {
                    location: {
                        type: "string",
                        description: "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                required: ["location"]
            }
        }
    }
];

async function main() {
    const rl = readline.createInterface({ input, output });
    const question = await rl.question("请输入您的问题："); 
    rl.close();
    
    const messages = [{ role: "user", content: question }];
    // 多模态模型的 message示例
    // const messages= [{
    //     role: "user",
    //     content: [{type: "image_url", image_url: {url: "https://img.alicdn.com/imgextra/i2/O1CN01FbTJon1ErXVGMRdsN_!!6000000000405-0-tps-1024-683.jpg"}},
    //               {type: "text", text: "图中地点的天气？"}]
    //   }];
    let reasoningContent = "";
    let answerContent = "";
    const toolInfo = [];
    let isAnswering = false;

    console.log("=".repeat(20) + "思考过程" + "=".repeat(20));
    
    try {
        const stream = await openai.chat.completions.create({
            // 此处以qwen-plus为例，可更换为其它深度思考模型
            model: "qwen-plus",
            messages,
            // 开启深度思考
            enable_thinking: true,
            tools,
            stream: true,
            parallel_tool_calls: true
        });

        for await (const chunk of stream) {
            if (!chunk.choices?.length) {
                console.log("\n" + "=".repeat(20) + "Usage" + "=".repeat(20));
                console.log(chunk.usage);
                continue;
            }

            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            // 处理思考过程
            if (delta.reasoning_content) {
                reasoningContent += delta.reasoning_content;
                process.stdout.write(delta.reasoning_content);
            }
            // 处理回复内容
            else {
                if (!isAnswering) {
                    isAnswering = true;
                    console.log("\n" + "=".repeat(20) + "回复内容" + "=".repeat(20));
                }
                if (delta.content) {
                    answerContent += delta.content;
                    process.stdout.write(delta.content);
                }
                // 处理工具调用
                if (delta.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                        const index = toolCall.index;
                        
                        // 确保数组长度足够
                        while (toolInfo.length <= index) {
                            toolInfo.push({});
                        }
                        
                        // 更新工具ID
                        if (toolCall.id) {
                            toolInfo[index].id = (toolInfo[index].id || "") + toolCall.id;
                        }
                        
                        // 更新函数名称
                        if (toolCall.function?.name) {
                            toolInfo[index].name = (toolInfo[index].name || "") + toolCall.function.name;
                        }
                        
                        // 更新参数
                        if (toolCall.function?.arguments) {
                            toolInfo[index].arguments = (toolInfo[index].arguments || "") + toolCall.function.arguments;
                        }
                    }
                }
            }
        }

        console.log("\n" + "=".repeat(19) + "工具调用信息" + "=".repeat(19));
        console.log(toolInfo.length ? toolInfo : "没有工具调用");

    } catch (error) {
        console.error("发生错误:", error);
    }
}

main(); 
```

### **返回结果**

输入“四个直辖市的天气”，得到以下返回结果：

```
请输入您的问题：四个直辖市的天气
====================思考过程====================
好的，用户问的是四个直辖市的天气。首先，我需要明确中国的四个直辖市分别是哪几个。北京、上海、天津和重庆，对吧？接下来，我需要为每个城市调用天气查询功能。

但是用户的问题可能需要我分别获取这四个城市的天气情况。每个城市都需要调用一次get_current_weather函数，参数是各自的城市名称。我需要确保参数正确，比如直辖市的全名，比如“北京市”、“上海市”、“天津市”和“重庆市”。

然后，我需要按照顺序依次调用这四个城市的天气接口。每个调用都需要单独的tool_call。用户可能希望得到每个城市的当前天气信息，所以需要确保每个调用都正确无误。可能需要注意每个城市的正确拼写和名称，避免出现错误。例如，重庆有时可能被简称为“重庆市”，所以参数里应该用全称。

现在，我需要生成四个tool_call，每个对应一个直辖市。检查每个参数是否正确，然后按顺序排列。这样用户就能得到四个直辖市的天气数据了。
====================回复内容====================

===================工具调用信息===================
[
  {
    id: 'call_21dc802e717f491298d1b2',
    name: 'get_current_weather',
    arguments: '{"location": "北京市"}'
  },
  {
    id: 'call_2cd3be1d2f694c4eafd4e5',
    name: 'get_current_weather',
    arguments: '{"location": "上海市"}'
  },
  {
    id: 'call_48cf3f78e02940bd9085e4',
    name: 'get_current_weather',
    arguments: '{"location": "天津市"}'
  },
  {
    id: 'call_e230a2b4c64f4e658d223e',
    name: 'get_current_weather',
    arguments: '{"location": "重庆市"}'
  }
]
```

## HTTP

### **示例代码**

## curl

```
# ======= 重要提示 =======
# 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions
# === 执行时请删除该注释 ===
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
    "model": "qwen-plus",
    "messages": [
        {
            "role": "user", 
            "content": "杭州天气怎么样"
        }
    ],
    "tools": [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "当你想知道现在的时间时非常有用。",
            "parameters": {}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location":{
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]
            }
        }
    }
  ],
  "enable_thinking": true,
  "stream": true
}'
```

## DashScope

## Python

### **示例代码**

```
import dashscope

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

tools = [
    # 工具1 获取当前时刻的时间
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "当你想知道现在的时间时非常有用。",
            "parameters": {}  # 因为获取当前时间无需输入参数，因此parameters为空字典
        }
    },  
    # 工具2 获取指定城市的天气
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {  
                "type": "object",
                "properties": {
                    # 查询天气时需要提供位置，因此参数设置为location
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]
            }
        }
    }
]

# 定义问题
messages = [{"role": "user", "content": input("请输入问题：")}]

# 多模态模型的 message示例
# messages = [
# {
#     "role": "user",
#     "content": [
#     {"image": "https://img.alicdn.com/imgextra/i2/O1CN01FbTJon1ErXVGMRdsN_!!6000000000405-0-tps-1024-683.jpg"},
#     {"text": "图像地点天气？"}]
# }]

# 如果使用多模态模型，请Generation替换为MultiModalConversation接口
completion = dashscope.Generation.call(
    # 此处以qwen-plus为例，可更换为其它深度思考模型
    model="qwen-plus", 
    messages=messages,
    enable_thinking=True,
    tools=tools,
    parallel_tool_calls=True,
    stream=True,
    incremental_output=True,
    result_format="message"
)

reasoning_content = ""
answer_content = ""
tool_info = []
is_answering = False
print("="*20+"思考过程"+"="*20)

for chunk in completion:
    if chunk.status_code == 200:
        msg = chunk.output.choices[0].message
        
        # 处理思考过程
        if 'reasoning_content' in msg and msg.reasoning_content:
            reasoning_content += msg.reasoning_content
            print(msg.reasoning_content, end="", flush=True)
        
        # 处理回复内容
        if 'content' in msg and msg.content:
            if not is_answering:
                is_answering = True
                print("\n"+"="*20+"回复内容"+"="*20)
            answer_content += msg.content
            print(msg.content, end="", flush=True)
        
        # 处理工具调用
        if 'tool_calls' in msg and msg.tool_calls:
            for tool_call in msg.tool_calls:
                index = tool_call['index']
                
                while len(tool_info) <= index:
                    tool_info.append({'id': '', 'name': '', 'arguments': ''})  # 初始化所有字段
                
                # 增量更新工具ID
                if 'id' in tool_call:
                    tool_info[index]['id'] += tool_call.get('id', '')
                
                # 增量更新函数信息
                if 'function' in tool_call:
                    func = tool_call['function']
                    # 增量更新函数名称
                    if 'name' in func:
                        tool_info[index]['name'] += func.get('name', '')
                    # 增量更新参数
                    if 'arguments' in func:
                        tool_info[index]['arguments'] += func.get('arguments', '')

print(f"\n"+"="*19+"工具调用信息"+"="*19)
if not tool_info:
    print("没有工具调用")
else:
    print(tool_info)
```

### **返回结果**

输入“四个直辖市的天气”，得到以下返回结果：

```
请输入问题：四个直辖市的天气
====================思考过程====================
好的，用户问的是四个直辖市的天气。首先，我需要确认中国的四个直辖市分别是哪些。北京、上海、天津和重庆，对吧？接下来，用户需要每个城市的天气情况，所以我需要调用天气查询功能。

不过，问题来了，用户没有指定具体的城市名称，只是说四个直辖市。可能需要我明确每个直辖市的名称，然后分别查询。比如，北京、上海、天津、重庆这四个直辖市。我需要确保每个城市都正确无误。

然后，我要检查可用的工具，用户提供的函数是get_current_weather，参数是location。因此，我需要为每个直辖市调用这个函数，传入对应的城市名称作为参数。比如，第一次调用location是北京市，第二次是上海市，第三次是天津市，第四次是重庆市。

不过，可能需要注意，像重庆这样的直辖市，有时候可能需要更具体的区，但用户可能只需要市级的天气。所以直接使用直辖市名称应该没问题。接下来，我需要生成四个独立的函数调用，每个对应一个直辖市。这样用户就能得到四个城市的天气情况了。

最后，确保每个调用的参数正确，并且没有遗漏。这样用户的问题就能得到完整的回答了。
===================工具调用信息===================
[{'id': 'call_2f774ed97b0e4b24ab10ec', 'name': 'get_current_weather', 'arguments': '{"location": "北京市"}'}, {'id': 'call_dc3b05b88baa48c58bc33a', 'name': 'get_current_weather', 'arguments': '{"location": "上海市"}}'}, {'id': 'call_249b2de2f73340cdb46cbc', 'name': 'get_current_weather', 'arguments': '{"location": "天津市"}'}, {'id': 'call_833333634fda49d1b39e87', 'name': 'get_current_weather', 'arguments': '{"location": "重庆市"}}'}]
```

## Java

### **示例代码**

```
// dashscope SDK的版本 >= 2.19.4
import java.util.Arrays;

import com.alibaba.dashscope.exception.UploadFileException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.dashscope.aigc.multimodalconversation.MultiModalConversation;
import com.alibaba.dashscope.aigc.multimodalconversation.MultiModalConversationParam;
import com.alibaba.dashscope.aigc.multimodalconversation.MultiModalConversationResult;
import com.alibaba.dashscope.common.MultiModalMessage;
import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import com.alibaba.dashscope.exception.ApiException;
import com.alibaba.dashscope.exception.InputRequiredException;
import com.alibaba.dashscope.exception.NoApiKeyException;
import com.alibaba.dashscope.utils.Constants;
import com.alibaba.dashscope.utils.JsonUtils;
import com.alibaba.dashscope.tools.ToolFunction;
import com.alibaba.dashscope.tools.FunctionDefinition;
import io.reactivex.Flowable;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.lang.System;
import com.github.victools.jsonschema.generator.Option;
import com.github.victools.jsonschema.generator.OptionPreset;
import com.github.victools.jsonschema.generator.SchemaGenerator;
import com.github.victools.jsonschema.generator.SchemaGeneratorConfig;
import com.github.victools.jsonschema.generator.SchemaGeneratorConfigBuilder;
import com.github.victools.jsonschema.generator.SchemaVersion;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;

public class Main {
    private static final Logger logger = LoggerFactory.getLogger(Main.class);
    private static ObjectNode jsonSchemaWeather;
    private static ObjectNode jsonSchemaTime;
    // 若使用新加坡地域的模型，请释放下列注释
    // static {Constants.baseHttpApiUrl="https://dashscope-intl.aliyuncs.com/api/v1";}

    static class TimeTool {
        public String call() {
            LocalDateTime now = LocalDateTime.now();
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
            return "当前时间：" + now.format(formatter) + "。";
        }
    }

    static class WeatherTool {
        private String location;

        public WeatherTool(String location) {
            this.location = location;
        }

        public String call() {
            return location + "今天是晴天";
        }
    }

    static {
        SchemaGeneratorConfigBuilder configBuilder = new SchemaGeneratorConfigBuilder(
                SchemaVersion.DRAFT_2020_12, OptionPreset.PLAIN_JSON);
        SchemaGeneratorConfig config = configBuilder
                .with(Option.EXTRA_OPEN_API_FORMAT_VALUES)
                .without(Option.FLATTENED_ENUMS_FROM_TOSTRING)
                .build();
        SchemaGenerator generator = new SchemaGenerator(config);
        jsonSchemaWeather = generator.generateSchema(WeatherTool.class);
        jsonSchemaTime = generator.generateSchema(TimeTool.class);
    }
    private static void handleGenerationResult(GenerationResult message) {
        System.out.println(JsonUtils.toJson(message));
    }
    
    // 为文本生成模型创建工具调用方法
    public static void streamCallWithMessage(Generation gen, Message userMsg)
            throws NoApiKeyException, ApiException, InputRequiredException {
        GenerationParam param = buildGenerationParam(userMsg);
        Flowable<GenerationResult> result = gen.streamCall(param);
        result.blockingForEach(message -> handleGenerationResult(message));
    }
    // 构建文本生成模型参数，支持工具调用
    private static GenerationParam buildGenerationParam(Message userMsg) {
        FunctionDefinition fdWeather = buildFunctionDefinition(
                "get_current_weather", "获取指定地区的天气", jsonSchemaWeather);
        FunctionDefinition fdTime = buildFunctionDefinition(
                "get_current_time", "获取当前时刻的时间", jsonSchemaTime);

        return GenerationParam.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .model("qwen-plus")
                .enableThinking(true)
                .messages(Arrays.asList(userMsg))
                .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                .incrementalOutput(true)
                .tools(Arrays.asList(
                        ToolFunction.builder().function(fdWeather).build(),
                        ToolFunction.builder().function(fdTime).build()))
                .build();
    }

    // 为多模态模型创建工具调用方法
    public static void streamCallWithMultiModalMessage(MultiModalConversation conv, MultiModalMessage userMsg)
            throws NoApiKeyException, ApiException, UploadFileException {
        MultiModalConversationParam param = buildMultiModalConversationParam(userMsg);
        Flowable<MultiModalConversationResult> result = conv.streamCall(param);
        result.blockingForEach(message -> System.out.println(JsonUtils.toJson(message)));
    }

    // 构建多模态模型参数，支持工具调用
    private static MultiModalConversationParam buildMultiModalConversationParam(MultiModalMessage userMsg) {
        FunctionDefinition fdWeather = buildFunctionDefinition(
                "get_current_weather", "获取指定地区的天气", jsonSchemaWeather);
        FunctionDefinition fdTime = buildFunctionDefinition(
                "get_current_time", "获取当前时刻的时间", jsonSchemaTime);

        return MultiModalConversationParam.builder()
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .model("qwen3-vl-plus")  // 使用多模态模型 Qwen3-VL
                .enableThinking(true)
                .messages(Arrays.asList(userMsg))
                .tools(Arrays.asList(  // 配置工具列表
                        ToolFunction.builder().function(fdWeather).build(),
                        ToolFunction.builder().function(fdTime).build()))
                .build();
    }

    private static FunctionDefinition buildFunctionDefinition(
            String name, String description, ObjectNode schema) {
        return FunctionDefinition.builder()
                .name(name)
                .description(description)
                .parameters(JsonUtils.parseString(schema.toString()).getAsJsonObject())
                .build();
    }

    public static void main(String[] args) {
        try {
            Generation gen = new Generation();
            Message userMsg = Message.builder()
                    .role(Role.USER.getValue())
                    .content("请告诉我杭州的天气")
                    .build();
            try {
                streamCallWithMessage(gen, userMsg);
            } catch (InputRequiredException e) {
                throw new RuntimeException(e);
            }
//             使用多模态模型进行工具调用时，请解除下列注释
//            MultiModalConversation conv = new MultiModalConversation();
//            MultiModalMessage userMessage = MultiModalMessage.builder().role(Role.USER.getValue())
//                    .content(Arrays.asList(Collections.singletonMap("image", "https://img.alicdn.com/imgextra/i2/O1CN01FbTJon1ErXVGMRdsN_!!6000000000405-0-tps-1024-683.jpg"),
//                            Collections.singletonMap("text", "图中地点的天气"))).build();
//            try {
//                streamCallWithMultiModalMessage(conv,userMessage);
//            } catch (UploadFileException e) {
//                throw new RuntimeException(e);
//            }
        } catch (ApiException | NoApiKeyException e) {
            logger.error("An exception occurred: {}", e.getMessage());
        }
        System.exit(0);
    }
}
```

### **返回结果**

```
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":6,"total_tokens":244},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"好的，用户让我"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":12,"total_tokens":250},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"告诉杭州的天气。我"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":16,"total_tokens":254},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"需要先确定是否有"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":22,"total_tokens":260},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"相关的工具可用。查看提供的"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":28,"total_tokens":266},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"工具，发现有一个get_current"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":34,"total_tokens":272},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"_weather函数，参数是location"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":38,"total_tokens":276},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"。所以应该调"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":43,"total_tokens":281},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"用这个函数，参数"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":48,"total_tokens":286},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"设为杭州。不需要"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":52,"total_tokens":290},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"其他工具，因为"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":56,"total_tokens":294},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"用户只问了"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":60,"total_tokens":298},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"天气。接下来构造"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":64,"total_tokens":302},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"tool_call，把"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":68,"total_tokens":306},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"名称和参数填"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":73,"total_tokens":311},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"进去。确保参数是"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":78,"total_tokens":316},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"JSON对象，location是"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":82,"total_tokens":320},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"字符串。检查无"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":88,"total_tokens":326},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"误后返回。"}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":106,"total_tokens":344},"output":{"choices":[{"finish_reason":"null","message":{"role":"assistant","content":"","reasoning_content":"","tool_calls":[{"type":"function","id":"call_ecc41296dccc47baa01567","function":{"name":"get_current_weather","arguments":"{\"location\": \"杭州"}}]}}]}}
{"requestId":"4edb81cd-4647-9d5d-88f9-a4f30bc6d8dd","usage":{"input_tokens":238,"output_tokens":108,"total_tokens":346},"output":{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":"","reasoning_content":"","tool_calls":[{"type":"function","id":"","function":{"arguments":"\"}"}}]}}]}}
```

## HTTP

### **示例代码**

## curl

```
# ======= 重要提示 =======
# 如果使用多模态模型，请修改message参数，并将url 替换为 https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
# 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation
# === 执行时请删除该注释 ===
curl -X POST "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation" \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-H "X-DashScope-SSE: enable" \
-d '{
    "model": "qwen-plus",
    "input":{
        "messages":[      
            {
                "role": "user",
                "content": "杭州天气"
            }
        ]
    },
    "parameters": {
        "enable_thinking": true,
        "incremental_output": true,
        "result_format": "message",
        "tools": [{
            "type": "function",
            "function": {
                "name": "get_current_time",
                "description": "当你想知道现在的时间时非常有用。",
                "parameters": {}
            }
        },{
            "type": "function",
            "function": {
                "name": "get_current_weather",
                "description": "当你想查询指定城市的天气时非常有用。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                        }
                    },
                    "required": ["location"]
                }
            }
        }]
    }
}'
```

## **应用于生产环境**

### **测试工具调用准确率**

-   **建立评估体系**：
    
    构建贴近真实业务的测试数据集，并定义清晰的评估指标，如：工具选择准确率、参数提取准确率、端到端成功率等。
    
-   **优化提示词**
    
    根据测试暴露出的具体问题（选错工具、参数错误），针对性地优化系统提示词、工具描述和参数描述，是核心的调优手段。
    
-   **升级模型**
    
    当提示词工程调优无法提升性能时，升级到能力更强的模型版本（如 `qwen3-max-preview`）是提升指标最直接有效的方法。
    

### **动态控制工具数量**

当应用集成的工具数量超过几十甚至上百个时，将整个工具库全部提供给模型会带来以下问题：

-   **性能下降**：模型在庞大的工具集中选择正确工具的难度剧增；
    
-   **成本与延迟**：大量的工具描述会消耗巨量的输入 Token，导致费用上升和响应变慢；
    

解决方案是**在调用模型前，增加一个工具路由/检索层**，根据用户当前查询，从完整的工具库中快速、精准地筛选出一个小而相关的工具子集，再将其提供给模型。

**实现工具路由的几种主流方法：**

-   **语义检索**
    
    预先将所有工具的描述信息（`description`）通过 Embedding 模型转化为向量，并存入向量数据库。当用户查询时，将查询向量通过向量相似度搜索，召回最相关的 Top-K 个工具。
    
-   **混合检索**
    
    将语义检索的“模糊匹配”能力与传统关键词或元数据标签的“精确匹配”能力相结合。为工具添加 `tags` 或 `keywords` 字段，检索时同时进行向量搜索和关键词过滤，可以大幅提升高频或特定场景下的召回精准度。
    
-   **轻量级 LLM 路由器**
    
    对于更复杂的路由逻辑，可以使用一个更小、更快、更便宜的模型（如 Qwen-Flash）作为前置“路由模型”。它的任务是根据用户问题输出相关的工具名称列表。
    

**实践建议**

-   **保持候选集精简**：无论使用何种方法，最终提供给主模型的工具数量建议**不超过 20 个**。这是在模型认知负荷、成本、延迟和准确率之间的最佳平衡点。
    
-   **分层过滤策略**：可以构建一个漏斗式的路由策略。例如，先用成本极低的关键词/规则匹配进行第一轮筛选，过滤掉明显不相关的工具，再对剩余的工具进行语义检索，从而提高效率和质量。
    

### **工具安全性原则**

将工具执行能力开放给大模型时，必须将安全置于首位。核心原则是“最小权限”和“人类确认”。

-   **最小权限原则**：为模型提供的工具集应严格遵守最小权限原则。默认情况下，工具应是只读的（如查询天气、搜索文档），避免直接提供任何涉及状态变更或资源操作的“写”权限。
    
-   **危险工具隔离**：请勿向大模型直接提供危险工具，例如执行任意代码（`code interpreter`）、操作文件系统（`fs.delete`）、执行数据库删除或更新操作（`db.drop_table`）或涉及资金流转的工具（`payment.transfer`）。
    
-   **人类参与**：对于所有高权限或不可逆的操作，必须引入人工审核和确认环节。模型可以生成操作请求，但最终的执行“按钮”必须由人类用户点击。例如，模型可以准备好一封邮件，但发送操作需要用户确认。
    

### **用户体验优化**

Function Calling 链路较长，任何一个环节出问题都可能导致用户体验下降。

#### **处理工具运行失败**

工具运行失败是常见情况。可采取以下策略：

-   **最大重试次数**：设置合理的重试上限（例如 3 次），避免因连续失败导致用户长时间等待或系统资源浪费。
    
-   **提供兜底话术**：当重试耗尽或遇到无法解决的错误时，应向用户返回清晰、友好的提示信息，例如：“抱歉，我暂时无法查询到相关信息，可能是服务有些繁忙，请您稍后再试。”
    

#### **应对处理延迟**

较高的延迟会降低用户满意度，需要通过前端交互和后端优化来改善。

-   **设置超时时间**：为 Function Calling 的每一步设置独立且合理的超时时间。一旦超时，应立即中断操作并给出反馈。
    
-   **提供即时反馈**：开始执行 Function Calling 时，建议在界面上给出提示，如“正在为您查询天气...”、“正在搜索相关信息...”，向用户实时反馈处理进度。
    

## **计费说明**

除了 messages 数组中的 Token 外，工具描述信息也会作为输入 Token 拼接到提示词中进行计费。

## **通过 System Message 传入工具信息**

推荐您参考[如何使用](#038e24005c1vt)部分，通过 tools 参数向大模型传入工具信息。如果您需要通过 System Message 传入工具信息，为了模型的最佳效果，请参考以下代码中的提示词模板：

## OpenAI兼容

## Python

### **示例代码**

```
import os
from openai import OpenAI
import json

client = OpenAI(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

# 自定义 System prompt，可根据您的需求修改
custom_prompt = "你是一个智能助手，专门负责调用各种工具来帮助用户解决问题。你可以根据用户的需求选择合适的工具并正确调用它们。"

tools = [
    # 工具1 获取当前时刻的时间
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "当你想知道现在的时间时非常有用。",
            "parameters": {}
        }
    },  
    # 工具2 获取指定城市的天气
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {  
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]
            }
        }
    }
]

# 遍历tools列表，为每个工具构建描述
tools_descriptions = []
for tool in tools:
    tool_json = json.dumps(tool, ensure_ascii=False)
    tools_descriptions.append(tool_json)

# 将所有工具描述组合成一个字符串
tools_content = "\n".join(tools_descriptions)

system_prompt = f"""{custom_prompt}

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
{tools_content}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{{"name": <function-name>, "arguments": <args-json-object>}}
</tool_call>"""

messages = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": "几点了"}
]

completion = client.chat.completions.create(
    model="qwen-plus",
    messages=messages,
)
print(completion.model_dump_json())
```

## Node.js

### 示例代码

```
import OpenAI from "openai";

const client = new OpenAI({
    // 若没有配置环境变量，请用百炼API Key将下行替换为：apiKey: "sk-xxx",
    // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    apiKey: process.env.DASHSCOPE_API_KEY,
    // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

// 自定义 System prompt
const customPrompt = "你是一个智能助手，专门负责调用各种工具来帮助用户解决问题。你可以根据用户的需求选择合适的工具并正确调用它们。";

const tools = [
    // 工具1 获取当前时刻的时间
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "当你想知道现在的时间时非常有用。",
            "parameters": {}
        }
    },
    // 工具2 获取指定城市的天气
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]
            }
        }
    }
];

// 遍历tools列表，为每个工具构建描述
const toolsDescriptions = [];
for (const tool of tools) {
    const toolJson = JSON.stringify(tool, null, 2);
    toolsDescriptions.push(toolJson);
}

// 将所有工具描述组合成一个字符串
const toolsContent = toolsDescriptions.join("\n");

const systemPrompt = `${customPrompt}

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
${toolsContent}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call>`;

const messages = [
    {"role": "system", "content": systemPrompt},
    {"role": "user", "content": "几点了"}
];

async function main() {
    try {
        const completion = await client.chat.completions.create({
            model: "qwen-plus",
            messages: messages,
        });
        
        console.log(JSON.stringify(completion, null, 2));
    } catch (error) {
        console.error("Error:", error);
    }
}

main(); 
```

## DashScope

## Python

### **示例代码**

```
import os
from dashscope import Generation
import json
import dashscope 

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

# 自定义 System prompt
custom_prompt = "你是一个智能助手，专门负责调用各种工具来帮助用户解决问题。你可以根据用户的需求选择合适的工具并正确调用它们。"

tools = [
    # 工具1 获取当前时刻的时间
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "当你想知道现在的时间时非常有用。",
            "parameters": {}
        }
    },  
    # 工具2 获取指定城市的天气
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "当你想查询指定城市的天气时非常有用。",
            "parameters": {  
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市或县区，比如北京市、杭州市、余杭区等。"
                    }
                },
                "required": ["location"]
            }
        }
    }
]

# 遍历tools列表，为每个工具构建描述
tools_descriptions = []
for tool in tools:
    tool_json = json.dumps(tool, ensure_ascii=False)
    tools_descriptions.append(tool_json)

# 将所有工具描述组合成一个字符串
tools_content = "\n".join(tools_descriptions)

system_prompt = f"""{custom_prompt}

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
{tools_content}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{{"name": <function-name>, "arguments": <args-json-object>}}
</tool_call>"""

messages = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": "几点了"}
]

response = Generation.call(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx",
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model="qwen-plus",
    messages=messages,
    result_format="message",  # 将输出设置为message形式
)

print(response)
```

## Java

### 示例代码

```
// Copyright (c) Alibaba, Inc. and its affiliates.
// version >= 2.12.0

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import com.alibaba.dashscope.aigc.conversation.ConversationParam.ResultFormat;
import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import com.alibaba.dashscope.exception.ApiException;
import com.alibaba.dashscope.exception.InputRequiredException;
import com.alibaba.dashscope.exception.NoApiKeyException;
import com.alibaba.dashscope.utils.Constants;
import com.alibaba.dashscope.utils.JsonUtils;

public class Main {
    //  若使用新加坡地域的模型，请释放下列注释
    //  static {Constants.baseHttpApiUrl="https://dashscope-intl.aliyuncs.com/api/v1";}
    public static void main(String[] args) {
        try {
            callToolWithCustomPrompt();
        } catch (ApiException | NoApiKeyException | InputRequiredException e) {
            System.out.println(String.format("Exception: %s", e.getMessage()));
        } catch (Exception e) {
            System.out.println(String.format("Exception: %s", e.getMessage()));
        }
        System.exit(0);
    }

    public static void callToolWithCustomPrompt()
            throws NoApiKeyException, ApiException, InputRequiredException {

        // 自定义 System prompt
        String customPrompt = "你是一个智能助手，专门负责调用各种工具来帮助用户解决问题。你可以根据用户的需求选择合适的工具并正确调用它们。";

        // 构建工具描述
        String[] toolsDescriptions = {
                // 工具1 获取当前时刻的时间
                "{\n" +
                        "    \"type\": \"function\",\n" +
                        "    \"function\": {\n" +
                        "        \"name\": \"get_current_time\",\n" +
                        "        \"description\": \"当你想知道现在的时间时非常有用。\",\n" +
                        "        \"parameters\": {}\n" +
                        "    }\n" +
                        "}",
                // 工具2 获取指定城市的天气
                "{\n" +
                        "    \"type\": \"function\",\n" +
                        "    \"function\": {\n" +
                        "        \"name\": \"get_current_weather\",\n" +
                        "        \"description\": \"当你想查询指定城市的天气时非常有用。\",\n" +
                        "        \"parameters\": {\n" +
                        "            \"type\": \"object\",\n" +
                        "            \"properties\": {\n" +
                        "                \"location\": {\n" +
                        "                    \"type\": \"string\",\n" +
                        "                    \"description\": \"城市或县区，比如北京市、杭州市、余杭区等。\"\n" +
                        "                }\n" +
                        "            },\n" +
                        "            \"required\": [\"location\"]\n" +
                        "        }\n" +
                        "    }\n" +
                        "}"
        };

        // 将所有工具描述组合成一个字符串
        String toolsContent = String.join("\n", toolsDescriptions);

        // 构建系统提示词
        String systemPrompt = String.format("%s\n\n" +
                        "# Tools\n\n" +
                        "You may call one or more functions to assist with the user query.\n\n" +
                        "You are provided with function signatures within <tools></tools> XML tags:\n" +
                        "<tools>\n%s\n</tools>\n\n" +
                        "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n"
                        +
                        "<tool_call>\n" +
                        "{\"name\": <function-name>, \"arguments\": <args-json-object>}\n" +
                        "</tool_call>",
                customPrompt, toolsContent);

        // 构建消息列表
        Message systemMsg = Message.builder()
                .role(Role.SYSTEM.getValue())
                .content(systemPrompt)
                .build();

        Message userMsg = Message.builder()
                .role(Role.USER.getValue())
                .content("几点了")
                .build();

        List<Message> messages = new ArrayList<>(Arrays.asList(systemMsg, userMsg));

        // 构建请求参数
        GenerationParam param = GenerationParam.builder()
                // 模型列表：https://help.aliyun.com/zh/model-studio/getting-started/models
                .model("qwen-plus")
                // 若没有配置环境变量，请用百炼API Key将下行替换为：.apiKey("sk-xxx")
                .apiKey(System.getenv("DASHSCOPE_API_KEY"))
                .messages(messages)
                .resultFormat(ResultFormat.MESSAGE)
                .build();

        // 调用生成接口
        Generation gen = new Generation();
        GenerationResult result = gen.call(param);

        // 输出结果
        System.out.println(JsonUtils.toJson(result));
    }
}
```

> 运行以上代码后，可以使用 XML 解析器提取 <tool\_call> 和 </tool\_call> 之间的工具调用信息，包括函数名和入参。

## 错误码

如果模型调用失败并返回报错信息，请参见[错误信息](https://help.aliyun.com/zh/model-studio/error-code)进行解决。