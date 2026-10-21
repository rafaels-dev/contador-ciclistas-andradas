"""
Configurações para o contador de veículos e pedestres — Andradas.
Câmera CAM 4 Intelbras, 1920x1080 @ 15fps, visão lateral.
"""

# Modelo YOLOv8 (baixado automaticamente na primeira execução)
MODELO = "yolov8n.pt"

# Modelo dedicado para BICICLETAS (fine-tuned nesta câmera com blur
# sintético — recupera bicicletas borradas no crepúsculo). None = usa só o
# modelo principal. As demais classes sempre vêm do MODELO principal.
MODELO_BICICLETAS = "runs/ft_blur/weights/best.pt"

# Posição X da linha de contagem (vertical, centro do frame 1920px)
LINHA_X = 960
LINHA_Y_INICIO = 0      # topo do frame
LINHA_Y_FIM = 1080      # base do frame

# Região de interesse vertical: cobre todo o frame
ROI_Y_MIN = 0
ROI_Y_MAX = 1080

# Detecção
CONFIANCA = 0.40
IOU = 0.50

# Distância máxima person ↔ bicycle/motorcycle para associação POR FRAME
# (a classificação final é por track: ver contador/detector.py)
DIST_MAX_CYCLIST_PX = 150

# EXPERIMENTAL (desligado): velocidade mínima (px/frame) para reclassificar
# como ciclista uma pessoa que cruza sem bicycle detectada (motion blur
# noturno esconde a bicicleta). Desativado porque trocas de ID do ByteTrack
# contaminam a velocidade do track e as faixas de pedestre/ciclista se
# sobrepõem nesta câmera. None = desligado.
LIMIAR_VEL_CICLISTA_PX_FRAME = None

# Classes COCO por categoria
# 0=person, 1=bicycle, 2=car, 3=motorcycle, 5=bus, 7=truck
CLASSES_CICLISTAS    = [0, 1]      # person próxima de bicycle
CLASSES_PEDESTRES    = [0]         # person sem bicycle próxima
# car, bus, truck — inclui ids 4/5 (bus/truck no modelo fine-tuned de 6
# classes) e 5/7 (COCO); ids não previstos pelo modelo em uso são inócuos
CLASSES_AUTOMOVEIS   = [2, 4, 5, 7]
CLASSES_MOTOCICLETAS = [3]         # motorcycle
