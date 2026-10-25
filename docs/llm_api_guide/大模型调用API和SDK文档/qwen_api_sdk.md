安装OpenAI Python SDK或DashScope Python SDK
步骤 2：调用大模型API
OpenAI Python SDKDashScope Python SDK
如果您安装完成了Python以及OpenAI的Python SDK，可以参考以下步骤发送您的API请求。

新建一个文件，命名为hello_qwen.py。

将以下代码复制到hello_qwen.py中并保存。

 
import os
from openai import OpenAI

try:
    client = OpenAI(
        # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
        # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
        api_key=os.getenv("DASHSCOPE_API_KEY"),
        # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    completion = client.chat.completions.create(
        model="qwen-plus",  # 模型列表：https://help.aliyun.com/zh/model-studio/getting-started/models
        messages=[
            {'role': 'system', 'content': 'You are a helpful assistant.'},
            {'role': 'user', 'content': '你是谁？'}
            ]
    )
    print(completion.choices[0].message.content)
except Exception as e:
    print(f"错误信息：{e}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
通过命令行运行python hello_qwen.py或python3 hello_qwen.py。

若提示No such file or directory，则需在文件名前指定具体文件路径。
运行后您将会看到输出结果：

 
我是阿里云开发的一款超大规模语言模型，我叫通义千问。


选择开发语言
选择您熟悉的语言或工具，用于调用大模型API。

PythonNode.jsJavacurl其它语言
步骤 1：配置Python环境
检查您的Python版本
配置虚拟环境（可选）
安装OpenAI Python SDK或DashScope Python SDK
您可以通过OpenAI的Python SDK或DashScope的Python SDK来调用阿里云百炼平台上的模型。

安装OpenAI Python SDK安装DashScope Python SDK
通过运行以下命令安装DashScope Python SDK：

 
# 如果运行失败，您可以将pip替换成pip3再运行
pip install -U dashscope
image

当终端出现Successfully installed ... dashscope-x.x.x的提示后，表示您已经成功安装DashScope Python SDK。

说明
如果在安装SDK过程中出现WARNING: You are using pip version xxx; however, version xxx is available.提示，此为pip工具版本更新通知，与SDK安装无关，请直接忽略即可。

步骤 2：调用大模型API
OpenAI Python SDKDashScope Python SDK
如果您安装完成了Python以及DashScope的Python SDK，可以参考以下步骤发送您的API请求。

新建一个文件，命名为hello_qwen.py。

将以下代码复制到hello_qwen.py中并保存。

 
import os
from dashscope import Generation
import dashscope 

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"
messages = [
    {'role': 'system', 'content': 'You are a helpful assistant.'},
    {'role': 'user', 'content': '你是谁？'}
    ]
response = Generation.call(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key = "sk-xxx",
    api_key=os.getenv("DASHSCOPE_API_KEY"), 
    model="qwen-plus",   # 模型列表：https://help.aliyun.com/zh/model-studio/getting-started/models
    messages=messages,
    result_format="message"
)

if response.status_code == 200:
    print(response.output.choices[0].message.content)
else:
    print(f"HTTP返回码：{response.status_code}")
    print(f"错误码：{response.code}")
    print(f"错误信息：{response.message}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
通过命令行运行python hello_qwen.py或python3 hello_qwen.py。

说明
本示例使用的运行命令需在Python文件所在目录执行，如果想要在任意位置执行，请在文件名前指定具体文件路径。

运行后您将会看到输出结果：

 
我是来自阿里云的大规模语言模型，我叫通义千问。